import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

// Reusable "select media" popup (categories-modal styling): browse the media
// library and pick a file, or upload a new one. onPick receives the file record
// ({ url, mime_type, original_name, ... }).
export default function MediaPicker({ onPick, onClose }) {
  const [files, setFiles]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError]     = useState(null);
  const [q, setQ]             = useState('');
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try { setFiles(await api.get('/media')); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      await load();
      // Newly uploaded → select it immediately
      if (data && data.url) onPick(data);
    } catch (err) {
      setError('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const isImage = (f) => f.mime_type && f.mime_type.startsWith('image/');
  const isVideo = (f) => f.mime_type && f.mime_type.startsWith('video/');
  const icon = (f) => isVideo(f) ? '🎬' : (f.mime_type && f.mime_type.startsWith('audio/')) ? '🎵' : '📄';

  const filtered = files.filter(f =>
    !q || (f.original_name || f.filename || '').toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Select media</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body">
          <div className="mp-toolbar">
            <input
              type="search"
              placeholder="🔍 Search media…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mp-search"
            />
            <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : '↑ Upload new'}
            </button>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept="image/*,video/*,audio/*" onChange={upload} />
          </div>

          {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

          {loading ? (
            <p className="help-text">Loading media…</p>
          ) : filtered.length === 0 ? (
            <p className="help-text">No media files{q ? ' match.' : ' yet — upload one above.'}</p>
          ) : (
            <div className="mp-grid">
              {filtered.map(f => (
                <button key={f.id} type="button" className="mp-card" onClick={() => onPick(f)} title={f.original_name || f.filename}>
                  {isImage(f)
                    ? <div className="mp-thumb"><img src={f.url} alt="" loading="lazy" /></div>
                    : <div className="mp-thumb mp-thumb-icon">{icon(f)}</div>}
                  <span className="mp-name">{f.original_name || f.filename}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}
