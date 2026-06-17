import { useState, useEffect, useRef } from 'react';

// Single-thread ffmpeg core is copied to /ffmpeg/* by the ffmpegCore() Vite
// plugin (served by nginx in production, dev middleware locally) — no CDN.
const FFMPEG_BASE = `${import.meta.env.BASE_URL || '/'}ffmpeg`.replace(/\/{2,}/g, '/');

// One shared ffmpeg instance — the ~25MB core only loads once per session.
let ffmpegSingleton = null;
async function getFFmpeg() {
  if (ffmpegSingleton) return ffmpegSingleton;
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');
  const ff = new FFmpeg();
  await ff.load({
    coreURL: await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegSingleton = ff;
  return ff;
}

const fmt = (s) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

function extOf(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file.original_name || file.filename || '');
  if (m) return m[1].toLowerCase();
  const mt = (file.mime_type || '').toLowerCase();
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('quicktime')) return 'mov';
  if (mt.includes('matroska')) return 'mkv';
  return 'mp4';
}

// In-browser video trimmer (ffmpeg.wasm). A fast lossless stream-copy cut keeps
// the source codec/format; the result is saved as a NEW media file. Cuts snap
// to the nearest keyframe (no re-encode), which is fast but not frame-exact.
export default function VideoEditor({ file, onClose, onSaved }) {
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');   // engine loading / running text
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const stopAtRef = useRef(null);

  const onMeta = () => {
    const d = videoRef.current?.duration || 0;
    setDuration(d);
    setEnd(d);
  };

  // Preview just the selected range
  const previewRange = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = start;
    stopAtRef.current = end;
    v.play();
  };
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (v && stopAtRef.current != null && v.currentTime >= stopAtRef.current) {
      v.pause();
      stopAtRef.current = null;
    }
  };

  useEffect(() => () => { stopAtRef.current = null; }, []);

  // mode: 'new' (upload a fresh file) | 'overwrite' (replace the original in place)
  async function save(mode) {
    if (mode === 'overwrite') {
      if (!file.id) { setError('Cannot overwrite this file — use Save as new.'); return; }
      if (!window.confirm('Overwrite the original file? This replaces it everywhere it is already used (existing questions / slides).')) return;
    }
    setBusy(true); setError(null); setProgress(0);
    try {
      setStatus('Loading video engine (one-time ~25 MB)…');
      const ff = await getFFmpeg();
      const { fetchFile } = await import('@ffmpeg/util');
      const onProg = ({ progress: p }) => setProgress(Math.min(100, Math.round((p || 0) * 100)));
      ff.on('progress', onProg);

      const ext = extOf(file);
      const inName = `in.${ext}`;
      const outName = `out.${ext}`;
      setStatus('Reading file…');
      await ff.writeFile(inName, await fetchFile(file.url));

      setStatus('Trimming…');
      // Fast-seek + duration + stream copy = quick lossless cut, keeps format.
      await ff.exec(['-ss', String(start), '-i', inName, '-t', String(Math.max(0.1, end - start)), '-c', 'copy', '-avoid_negative_ts', 'make_zero', outName]);

      const data = await ff.readFile(outName);
      ff.off?.('progress', onProg);
      try { await ff.deleteFile(inName); await ff.deleteFile(outName); } catch { /* noop */ }

      const mime = file.mime_type || `video/${ext}`;
      const blob = new Blob([data.buffer], { type: mime });
      const base = (file.original_name || file.filename || 'video').replace(/\.[^.]+$/, '');
      const fd = new FormData();
      let res;
      if (mode === 'overwrite') {
        fd.append('file', new File([blob], `${base}.${ext}`, { type: mime }));
        setStatus('Uploading…');
        res = await fetch(`/api/upload/media/${file.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${localStorage.getItem('qm_admin_token')}` },
          body: fd
        });
      } else {
        const suggested = `${base}-trimmed`;
        const name = window.prompt('Save the trimmed video as (name shown in the Media Library):', suggested);
        if (name === null) { setBusy(false); setStatus(''); return; } // cancelled
        fd.append('file', new File([blob], `${suggested}.${ext}`, { type: mime }));
        fd.append('display_name', name.trim() || suggested);
        if (file.folder) fd.append('folder', file.folder);
        setStatus('Uploading…');
        res = await fetch('/api/upload/media', {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('qm_admin_token')}` },
          body: fd
        });
      }
      if (!res.ok) throw new Error(await res.text());
      const saved = await res.json().catch(() => null);
      onSaved?.(saved);
    } catch (err) {
      setError('Trim failed: ' + (err?.message || err));
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>✂ Trim video — {file.original_name || file.filename}</h3>
          <button onClick={onClose} className="btn-close" disabled={busy}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

          <video
            ref={videoRef}
            src={file.url}
            controls
            onLoadedMetadata={onMeta}
            onTimeUpdate={onTimeUpdate}
            className="ve-video"
          />

          <div className="ae-row">
            <label className="ae-field">
              <span>Start — {fmt(start)}</span>
              <input type="range" min={0} max={duration} step={0.05} value={start}
                onChange={(e) => setStart(Math.min(parseFloat(e.target.value), end - 0.1))} />
            </label>
            <label className="ae-field">
              <span>End — {fmt(end)}</span>
              <input type="range" min={0} max={duration} step={0.05} value={end}
                onChange={(e) => setEnd(Math.max(parseFloat(e.target.value), start + 0.1))} />
            </label>
          </div>
          <div className="ae-row">
            <button type="button" className="btn btn-secondary btn-sm"
              onClick={() => setStart(Math.min(videoRef.current?.currentTime || 0, end - 0.1))}>⇤ Set start to playhead</button>
            <button type="button" className="btn btn-secondary btn-sm"
              onClick={() => setEnd(Math.max(videoRef.current?.currentTime || 0, start + 0.1))}>Set end to playhead ⇥</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={previewRange}>▶ Preview range</button>
          </div>

          <p className="help-text">
            Clip: {fmt(start)} → {fmt(end)} ({fmt(Math.max(0, end - start))}). Saved as a new <strong>.{extOf(file)}</strong> (lossless trim — cuts snap to the nearest keyframe).
          </p>
          {busy && (
            <div className="ve-status">
              <p className="help-text">{status}</p>
              {progress > 0 && <div className="ve-bar"><div className="ve-bar-fill" style={{ width: `${progress}%` }} /></div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={() => save('new')} disabled={busy || !duration}>
            {busy ? 'Working…' : '💾 Save as new'}
          </button>
          {file.id && (
            <button className="btn btn-warning" onClick={() => save('overwrite')} disabled={busy || !duration} title="Replace the original file everywhere it's used">
              ♻ Overwrite original
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
