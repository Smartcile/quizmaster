import { useState, useEffect, useRef, useCallback } from 'react';

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

// In-browser audio trimmer: trim start/end, fade in/out, gain/normalise, then
// export to WAV and upload as a NEW media file (the original is untouched).
export default function AudioEditor({ file, onClose, onSaved }) {
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

  const canvasRef = useRef(null);
  const playRef = useRef(null);   // { ctx, node }

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
      } catch (err) {
        if (!cancelled) setError('Could not decode this audio file: ' + err.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; stopPreview(); };
  }, [file.url]);

  // Draw waveform + selection shading
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e1f';
    ctx.fillRect(0, 0, w, h);

    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    ctx.strokeStyle = '#00f0ff';
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      for (let i = 0; i < step; i++) {
        const v = data[x * step + i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(x, (1 + min) * h / 2);
      ctx.lineTo(x, (1 + max) * h / 2);
    }
    ctx.stroke();

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
    ctx.lineWidth = 1;
  }, [buffer, start, end]);

  useEffect(() => { draw(); }, [draw]);

  function stopPreview() {
    if (playRef.current) {
      try { playRef.current.node.stop(); } catch { /* already stopped */ }
      try { playRef.current.ctx.close(); } catch { /* noop */ }
      playRef.current = null;
    }
    setPlaying(false);
  }

  async function preview() {
    if (!buffer) return;
    stopPreview();
    try {
      const edited = await renderEdited(buffer, { start, end, fadeIn, fadeOut, gain });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const node = ctx.createBufferSource();
      node.buffer = edited;
      node.connect(ctx.destination);
      node.onended = () => stopPreview();
      node.start(0);
      playRef.current = { ctx, node };
      setPlaying(true);
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

  async function save() {
    if (!buffer) return;
    setSaving(true); setError(null);
    stopPreview();
    try {
      const edited = await renderEdited(buffer, { start, end, fadeIn, fadeOut, gain });
      const fmtOut = outFormatFor(file);
      const blob = fmtOut === 'wav' ? audioBufferToWav(edited) : await audioBufferToMp3(edited);
      const ext = fmtOut === 'wav' ? 'wav' : 'mp3';
      const base = (file.original_name || file.filename || 'audio').replace(/\.[^.]+$/, '');
      const suggested = `${base}-edited`;
      const name = window.prompt('Save the edited audio as (name shown in the Media Library):', suggested);
      if (name === null) { setSaving(false); return; } // cancelled
      const newFile = new File([blob], `${suggested}.${ext}`, { type: blob.type });
      const fd = new FormData();
      fd.append('file', newFile);
      fd.append('display_name', name.trim() || suggested);
      if (file.folder) fd.append('folder', file.folder);
      const res = await fetch('/api/upload/media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('qm_admin_token')}` },
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      onSaved?.(data);
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
              <canvas ref={canvasRef} width={620} height={140} className="ae-wave" />
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
                Clip: {fmt(start)} → {fmt(end)} ({fmt(Math.max(0, end - start))}).
                {' '}Exported as <strong>{outFormatFor(file) === 'wav' ? 'WAV (lossless)' : 'MP3'}</strong> to match the source.
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={playing ? stopPreview : preview} disabled={!buffer}>
            {playing ? '■ Stop' : '▶ Preview'}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!buffer || saving}>
            {saving ? 'Saving…' : '💾 Save as new file'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
