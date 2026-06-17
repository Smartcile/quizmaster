import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ── WAV (16-bit PCM) encoder for an AudioBuffer ───────────────────────────────
function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const blockAlign = numCh * 2;
  const dataSize = numFrames * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  let off = 0;
  writeStr(off, 'RIFF'); off += 4;
  view.setUint32(off, 36 + dataSize, true); off += 4;
  writeStr(off, 'WAVE'); off += 4;
  writeStr(off, 'fmt '); off += 4;
  view.setUint32(off, 16, true); off += 4;
  view.setUint16(off, 1, true); off += 2;        // PCM
  view.setUint16(off, numCh, true); off += 2;
  view.setUint32(off, sampleRate, true); off += 4;
  view.setUint32(off, sampleRate * blockAlign, true); off += 4;
  view.setUint16(off, blockAlign, true); off += 2;
  view.setUint16(off, 16, true); off += 2;
  writeStr(off, 'data'); off += 4;
  view.setUint32(off, dataSize, true); off += 4;
  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Encode an AudioBuffer to MP3 (lamejs, lazy-loaded). Mono or stereo.
async function audioBufferToMp3(buffer, kbps = 192) {
  const lamejs = (await import('@breezystack/lamejs')).default;
  const channels = Math.min(2, buffer.numberOfChannels);
  const enc = new lamejs.Mp3Encoder(channels, buffer.sampleRate, kbps);
  const left = floatToInt16(buffer.getChannelData(0));
  const right = channels > 1 ? floatToInt16(buffer.getChannelData(1)) : null;
  const block = 1152;
  const chunks = [];
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const mp3 = right ? enc.encodeBuffer(l, right.subarray(i, i + block)) : enc.encodeBuffer(l);
    if (mp3.length) chunks.push(new Uint8Array(mp3));
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

// Match the source format where we can encode it in-browser: WAV stays WAV
// (lossless); MP3 and every other compressed source export as MP3.
function outFormatFor(file) {
  const name = (file.original_name || file.filename || '').toLowerCase();
  const mt = (file.mime_type || '').toLowerCase();
  if (mt.includes('wav') || /\.wav$/.test(name)) return 'wav';
  return 'mp3';
}

// Render the trimmed region with fades + gain applied, into a fresh AudioBuffer.
async function renderEdited(srcBuffer, { start, end, fadeIn, fadeOut, gain }) {
  const sr = srcBuffer.sampleRate;
  const startF = Math.max(0, Math.floor(start * sr));
  const endF = Math.min(srcBuffer.length, Math.floor(end * sr));
  const len = Math.max(1, endF - startF);
  const ch = srcBuffer.numberOfChannels;
  const ctx = new OfflineAudioContext(ch, len, sr);
  const trimmed = ctx.createBuffer(ch, len, sr);
  for (let c = 0; c < ch; c++) {
    trimmed.copyToChannel(srcBuffer.getChannelData(c).subarray(startF, endF), c, 0);
  }
  const node = ctx.createBufferSource();
  node.buffer = trimmed;
  const g = ctx.createGain();
  const dur = len / sr;
  const fi = Math.min(fadeIn, dur);
  const fo = Math.min(fadeOut, Math.max(0, dur - fi));
  g.gain.setValueAtTime(fi > 0 ? 0.0001 : gain, 0);
  if (fi > 0) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), fi);
  else g.gain.setValueAtTime(gain, 0);
  if (fo > 0) {
    g.gain.setValueAtTime(Math.max(0.0001, gain), Math.max(fi, dur - fo));
    g.gain.exponentialRampToValueAtTime(0.0001, dur);
  }
  node.connect(g); g.connect(ctx.destination);
  node.start(0);
  return await ctx.startRendering();
}

const fmt = (s) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// Parse LRC (timed lyrics): lines like "[00:12.34] words" → [{ t, text }] sorted.
const LRC_TS = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
function parseLRC(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LRC_TS)];
    const lyric = raw.replace(LRC_TS, '').trim();
    for (const m of stamps) {
      const t = (+m[1]) * 60 + (+m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
      out.push({ t, text: lyric });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// Re-serialize LRC text with every timestamp shifted by `offset` seconds
// (clamped at 0) — used to bake a lyric-sync nudge into the saved file.
function shiftLrcText(text, offset) {
  if (!text || !offset) return text;
  return String(text).replace(LRC_TS, (m, mm, ss, frac) => {
    let t = (+mm) * 60 + (+ss) + (frac ? Number(`0.${frac}`) : 0) + offset;
    if (t < 0) t = 0;
    const M = Math.floor(t / 60);
    const S = t - M * 60;
    return `[${String(M).padStart(2, '0')}:${S.toFixed(2).padStart(5, '0')}]`;
  });
}

// In-browser audio trimmer: trim start/end, fade in/out, gain/normalise, then
// export to WAV and upload as a NEW media file (the original is untouched).
export default function AudioEditor({ file, onClose, onSaved, defaultMarkAnswer = false }) {
  const [buffer, setBuffer] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [gain, setGain] = useState(1);

  const [playhead, setPlayhead] = useState(0);   // scrub cursor (Audacity-style)
  const [lyricsOffset, setLyricsOffset] = useState(0); // sync nudge (seconds)

  const canvasRef = useRef(null);
  const playRef = useRef(null);   // { ctx, node }
  const rafRef = useRef(null);
  const dragRef = useRef(null);   // 'start' | 'end' | 'seek' | null
  const peaksRef = useRef(null);  // cached [min,max] per pixel column

  // Lyrics for the karaoke view. Synced (LRC) lines carry timestamps so they can
  // light up + auto-scroll while you scrub; plain lyrics show as a static list.
  // The sync nudge shifts every timestamp live so you can line them up.
  const lrc = useMemo(() => {
    const base = file.lyrics_synced ? parseLRC(file.lyrics) : [];
    return lyricsOffset ? base.map(l => ({ ...l, t: Math.max(0, l.t + lyricsOffset) })) : base;
  }, [file.lyrics, file.lyrics_synced, lyricsOffset]);
  const synced = file.lyrics_synced && lrc.length > 0;
  const lines = useMemo(() => {
    if (synced) return lrc;
    return String(file.lyrics || '').split(/\r?\n/).map(t => ({ t: null, text: t.trim() })).filter(l => l.text);
  }, [synced, lrc, file.lyrics]);

  const [focusTime, setFocusTime] = useState(0);
  useEffect(() => { if (!playing) setFocusTime(playhead); }, [playhead, playing]);

  // Index of the line currently playing (synced only) — drives highlight + scroll.
  const curIdx = useMemo(() => {
    if (!synced) return -1;
    let idx = -1;
    for (let k = 0; k < lines.length; k++) { if (lines[k].t <= focusTime + 0.05) idx = k; else break; }
    return idx;
  }, [synced, lines, focusTime]);

  // Answer selection: click lyric lines to mark the "missing" Finish-the-Lyrics
  // answer (highlighted yellow). Reconstruct any previously-saved selection.
  const [markAnswer, setMarkAnswer] = useState(!!defaultMarkAnswer);
  const [answerSel, setAnswerSel] = useState(() => new Set());
  useEffect(() => {
    if (!file.ftl_answer || !lines.length) return;
    const ansLines = new Set(String(file.ftl_answer).split(/\r?\n/).map(s => s.trim()).filter(Boolean));
    const pre = new Set();
    lines.forEach((l, k) => { if (ansLines.has(l.text.trim())) pre.add(k); });
    if (pre.size) { setAnswerSel(pre); setMarkAnswer(true); }
  }, [file.ftl_answer, lines]);

  const toggleLine = (k) => {
    if (!markAnswer) return;
    setAnswerSel(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  };

  const selIdx = useMemo(() => [...answerSel].sort((a, b) => a - b), [answerSel]);
  const answerText = useMemo(() => selIdx.map(k => lines[k]?.text || '').filter(Boolean).join('\n'), [selIdx, lines]);
  const answerStop = (synced && selIdx.length) ? Math.max(0, +(lines[selIdx[0]].t - start).toFixed(3)) : null;

  const lyricsBoxRef = useRef(null);
  const activeLineRef = useRef(null);
  useEffect(() => {
    const el = activeLineRef.current, box = lyricsBoxRef.current;
    if (el && box) box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  }, [curIdx]);

  // Decode the source file
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true); setError(null);
      try {
        const res = await fetch(file.url);
        const ab = await res.arrayBuffer();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const buf = await ctx.decodeAudioData(ab);
        ctx.close?.();
        if (cancelled) return;
        setBuffer(buf);
        setStart(0);
        setEnd(buf.duration);
        setPlayhead(0);
      } catch (err) {
        if (!cancelled) setError('Could not decode this audio file: ' + err.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; stopPreview(); };
  }, [file.url]);

  // Cache the waveform peaks once per buffer so per-frame redraws (playhead
  // animation) stay cheap.
  useEffect(() => {
    if (!buffer) { peaksRef.current = null; return; }
    const w = canvasRef.current?.width || 620;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    const peaks = new Array(w);
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      for (let i = 0; i < step; i++) { const v = data[x * step + i] || 0; if (v < min) min = v; if (v > max) max = v; }
      peaks[x] = [min, max];
    }
    peaksRef.current = peaks;
  }, [buffer]);

  // Draw waveform + selection shading + handles + playhead cursor
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e1f';
    ctx.fillRect(0, 0, w, h);

    const peaks = peaksRef.current;
    if (peaks) {
      ctx.strokeStyle = '#00f0ff';
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const [min, max] = peaks[x] || [0, 0];
        ctx.moveTo(x, (1 + min) * h / 2);
        ctx.lineTo(x, (1 + max) * h / 2);
      }
      ctx.stroke();
    }

    // Dim the regions outside [start, end]
    const dur = buffer.duration || 1;
    const sx = (start / dur) * w;
    const ex = (end / dur) * w;
    ctx.fillStyle = 'rgba(7,9,26,0.7)';
    ctx.fillRect(0, 0, sx, h);
    ctx.fillRect(ex, 0, w - ex, h);
    ctx.strokeStyle = '#ff9d00';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, h); ctx.stroke();

    // Playhead cursor (white)
    const px = (Math.min(Math.max(focusTime, 0), dur) / dur) * w;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }, [buffer, start, end, focusTime]);

  useEffect(() => { draw(); }, [draw]);

  // ── Audacity-style waveform interaction ──────────────────────────────────
  // Click sets the playhead; drag the orange handles to trim; drag elsewhere
  // scrubs the cursor. (Audio doesn't live-seek — press Play to hear from here.)
  const xToTime = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return 0;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * buffer.duration;
  };
  const applyWaveDrag = (clientX, mode) => {
    const t = xToTime(clientX);
    if (mode === 'start') setStart(Math.min(t, end - 0.05));
    else if (mode === 'end') setEnd(Math.max(t, start + 0.05));
    else setPlayhead(Math.min(Math.max(t, 0), buffer.duration));
  };
  const onWaveMove = (e) => { if (dragRef.current) applyWaveDrag(e.clientX, dragRef.current); };
  const onWaveUp = () => {
    dragRef.current = null;
    window.removeEventListener('mousemove', onWaveMove);
    window.removeEventListener('mouseup', onWaveUp);
  };
  const onWaveDown = (e) => {
    if (!buffer) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dur = buffer.duration || 1;
    const xOf = (t) => (t / dur) * rect.width;
    const mx = e.clientX - rect.left;
    let mode = 'seek';
    if (Math.abs(mx - xOf(start)) <= 7) mode = 'start';
    else if (Math.abs(mx - xOf(end)) <= 7) mode = 'end';
    dragRef.current = mode;
    applyWaveDrag(e.clientX, mode);
    window.addEventListener('mousemove', onWaveMove);
    window.addEventListener('mouseup', onWaveUp);
  };

  function stopPreview() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (playRef.current) {
      try { playRef.current.node.stop(); } catch { /* already stopped */ }
      try { playRef.current.ctx.close(); } catch { /* noop */ }
      playRef.current = null;
    }
    setPlaying(false);
    setFocusTime(playhead);
  }

  async function preview() {
    if (!buffer) return;
    stopPreview();
    // Play from the cursor if it sits inside the clip, else from the clip start.
    const from = Math.min(Math.max(playhead, start), Math.max(start, end - 0.05));
    const fadeFromStart = Math.abs(from - start) < 0.02;
    try {
      const edited = await renderEdited(buffer, { start: from, end, fadeIn: fadeFromStart ? fadeIn : 0, fadeOut, gain });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const node = ctx.createBufferSource();
      node.buffer = edited;
      node.connect(ctx.destination);
      node.onended = () => stopPreview();
      node.start(0);
      playRef.current = { ctx, node };
      setPlaying(true);
      // Track playback position (original-track time) to drive the lyric line + cursor.
      const tick = () => {
        if (!playRef.current) return;
        setFocusTime(Math.min(end, from + playRef.current.ctx.currentTime));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError('Preview failed: ' + err.message);
    }
  }

  function normalize() {
    if (!buffer) return;
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    if (peak > 0) setGain(Math.min(4, +(1 / peak).toFixed(2)));
  }

  // mode: 'new' (upload a fresh file) | 'overwrite' (replace the original in place)
  async function save(mode) {
    if (!buffer) return;
    if (mode === 'overwrite') {
      if (!file.id) { setError('Cannot overwrite this file — use Save as new.'); return; }
      if (!window.confirm('Overwrite the original file? This replaces it everywhere it is already used (existing questions / slides).')) return;
    }
    setSaving(true); setError(null);
    stopPreview();
    try {
      const edited = await renderEdited(buffer, { start, end, fadeIn, fadeOut, gain });
      const fmtOut = outFormatFor(file);
      const blob = fmtOut === 'wav' ? audioBufferToWav(edited) : await audioBufferToMp3(edited);
      const ext = fmtOut === 'wav' ? 'wav' : 'mp3';
      const base = (file.original_name || file.filename || 'audio').replace(/\.[^.]+$/, '');
      // Bake any lyric-sync nudge into the saved copy so timing stays corrected.
      const lyricsToSave = (file.lyrics_synced && lyricsOffset) ? shiftLrcText(file.lyrics, lyricsOffset) : file.lyrics;

      const fd = new FormData();
      fd.append('file', new File([blob], `${base}.${ext}`, { type: blob.type }));
      if (lyricsToSave) { fd.append('lyrics', lyricsToSave); fd.append('lyrics_synced', String(!!file.lyrics_synced)); }
      // A marked Finish-the-Lyrics answer is remembered on the saved file and
      // (for the question editor) handed back via onSaved's second argument.
      if (markAnswer && answerText) {
        fd.append('ftl_answer', answerText);
        if (answerStop != null) fd.append('ftl_stop_seconds', String(answerStop));
      }

      let res;
      if (mode === 'overwrite') {
        res = await fetch(`/api/upload/media/${file.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${localStorage.getItem('qm_admin_token')}` },
          body: fd
        });
      } else {
        const suggested = `${base}-edited`;
        const name = window.prompt('Save the edited audio as (name shown in the Media Library):', suggested);
        if (name === null) { setSaving(false); return; } // cancelled
        fd.append('display_name', name.trim() || suggested);
        if (file.folder) fd.append('folder', file.folder);
        // Carry the source track's tags forward — the re-encoded clip has none.
        if (file.artist) fd.append('artist', file.artist);
        if (file.title) fd.append('title', file.title);
        if (file.album) fd.append('album', file.album);
        res = await fetch('/api/upload/media', {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('qm_admin_token')}` },
          body: fd
        });
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      onSaved?.(data, { answer: answerText, stopSeconds: answerStop, markAnswer });
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const dur = buffer?.duration || 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>✂ Edit audio — {file.original_name || file.filename}</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}
          {busy ? (
            <p className="help-text">Decoding audio…</p>
          ) : !buffer ? (
            <p className="help-text">No audio loaded.</p>
          ) : (
            <>
              <canvas ref={canvasRef} width={620} height={140} className="ae-wave" onMouseDown={onWaveDown} title="Click to place the cursor · drag the orange edges to trim" />
              {lines.length > 0 ? (
                <div className="ae-lyrics-panel">
                  <div className="ae-lyrics-bar">
                    <span className="ae-lyrics-time">{synced ? `▶ ${fmt(focusTime)}` : 'Lyrics'}</span>
                    {synced && (
                      <span className="ae-lyrics-sync" title="Nudge the lyric timing if it's slightly out of sync">
                        Sync
                        <button type="button" onClick={() => setLyricsOffset(o => +(o - 0.5).toFixed(2))}>−0.5</button>
                        <button type="button" onClick={() => setLyricsOffset(o => +(o - 0.1).toFixed(2))}>−0.1</button>
                        <span className="ae-sync-val">{lyricsOffset > 0 ? '+' : ''}{lyricsOffset.toFixed(1)}s</span>
                        <button type="button" onClick={() => setLyricsOffset(o => +(o + 0.1).toFixed(2))}>+0.1</button>
                        <button type="button" onClick={() => setLyricsOffset(o => +(o + 0.5).toFixed(2))}>+0.5</button>
                        {lyricsOffset !== 0 && <button type="button" onClick={() => setLyricsOffset(0)}>reset</button>}
                      </span>
                    )}
                    <label className="ae-lyrics-mark">
                      <input
                        type="checkbox"
                        checked={markAnswer}
                        onChange={(e) => { setMarkAnswer(e.target.checked); if (!e.target.checked) setAnswerSel(new Set()); }}
                      />
                      🎤 Mark “Finish the Lyrics” answer
                    </label>
                  </div>
                  {markAnswer && (
                    <p className="ae-lyrics-hint">
                      Click the line(s) the teams must complete — they turn <span className="ae-ans-chip">yellow</span>.
                      {synced
                        ? ' The snippet stops right before the first highlighted line.'
                        : ' These lyrics aren’t timed, so set the stop time on the question manually.'}
                    </p>
                  )}
                  <div className="ae-lyrics-box" ref={lyricsBoxRef}>
                    {lines.map((l, k) => {
                      const outside = synced && l.t != null && (l.t < start || l.t > end);
                      const cls = [
                        'ae-lyric-line',
                        k === curIdx ? 'is-current' : '',
                        answerSel.has(k) ? 'is-answer' : '',
                        outside ? 'is-outside' : '',
                        markAnswer ? 'is-clickable' : ''
                      ].filter(Boolean).join(' ');
                      return (
                        <div
                          key={k}
                          className={cls}
                          ref={k === curIdx ? activeLineRef : null}
                          onClick={() => toggleLine(k)}
                        >
                          {synced && l.t != null && <span className="ae-lyric-t">{fmt(l.t)}</span>}
                          <span className="ae-lyric-txt">{l.text}</span>
                        </div>
                      );
                    })}
                  </div>
                  {markAnswer && answerText && (
                    <p className="help-text ae-ans-preview">
                      Answer: <strong>{answerText.replace(/\n/g, ' / ')}</strong>
                      {answerStop != null && <> · snippet stops at {fmt(answerStop)}</>}
                    </p>
                  )}
                </div>
              ) : (
                <p className="help-text" style={{ marginTop: 6 }}>
                  No lyrics on this track yet — add or fetch them in the Media Library to see them here while you scrub and to mark a Finish-the-Lyrics answer.
                </p>
              )}
              <div className="ae-row">
                <label className="ae-field">
                  <span>Start — {fmt(start)}</span>
                  <input type="range" min={0} max={dur} step={0.01} value={start}
                    onChange={(e) => setStart(Math.min(parseFloat(e.target.value), end - 0.05))} />
                </label>
                <label className="ae-field">
                  <span>End — {fmt(end)}</span>
                  <input type="range" min={0} max={dur} step={0.01} value={end}
                    onChange={(e) => setEnd(Math.max(parseFloat(e.target.value), start + 0.05))} />
                </label>
              </div>
              <div className="ae-row">
                <label className="ae-field">
                  <span>Fade in (s)</span>
                  <input type="number" min={0} max={dur} step={0.1} value={fadeIn}
                    onChange={(e) => setFadeIn(Math.max(0, parseFloat(e.target.value) || 0))} />
                </label>
                <label className="ae-field">
                  <span>Fade out (s)</span>
                  <input type="number" min={0} max={dur} step={0.1} value={fadeOut}
                    onChange={(e) => setFadeOut(Math.max(0, parseFloat(e.target.value) || 0))} />
                </label>
                <label className="ae-field">
                  <span>Volume — {Math.round(gain * 100)}%</span>
                  <input type="range" min={0} max={4} step={0.05} value={gain}
                    onChange={(e) => setGain(parseFloat(e.target.value))} />
                </label>
                <button type="button" className="btn btn-secondary btn-sm" onClick={normalize}>Normalise</button>
              </div>
              <p className="help-text">
                Click the waveform to place the cursor, drag the orange edges to trim. Clip: {fmt(start)} → {fmt(end)} ({fmt(Math.max(0, end - start))}).
                {' '}Exported as <strong>{outFormatFor(file) === 'wav' ? 'WAV (lossless)' : 'MP3'}</strong> to match the source.
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={playing ? stopPreview : preview} disabled={!buffer} title="Play from the cursor">
            {playing ? '■ Stop' : '▶ Play'}
          </button>
          <button className="btn btn-primary" onClick={() => save('new')} disabled={!buffer || saving}>
            {saving ? 'Saving…' : '💾 Save as new'}
          </button>
          {file.id && (
            <button className="btn btn-warning" onClick={() => save('overwrite')} disabled={!buffer || saving} title="Replace the original file everywhere it's used">
              ♻ Overwrite original
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
