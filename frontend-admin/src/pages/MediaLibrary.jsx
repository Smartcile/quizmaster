import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

const USAGE_CHIP_COLORS = {
  'Question':     { bg: 'rgba(0,240,255,0.15)',   color: '#00f0ff' },
  'Slide Master': { bg: 'rgba(184,41,255,0.15)',  color: '#b829ff' },
};

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
         ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function isImage(file) {
  return file.mime_type && file.mime_type.startsWith('image/');
}

function isVideo(file) {
  return file.mime_type && file.mime_type.startsWith('video/');
}

function isAudio(file) {
  return file.mime_type && file.mime_type.startsWith('audio/');
}

function FileIcon({ file }) {
  if (isVideo(file)) return <span className="media-icon">🎬</span>;
  if (isAudio(file)) return <span className="media-icon">🎵</span>;
  return <span className="media-icon">📄</span>;
}

export default function MediaLibrary() {
  const [files,      setFiles]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [selected,   setSelected]   = useState(null);   // file object for detail modal
  const [usageData,  setUsageData]  = useState(null);   // { file, usage }
  const [uploading,  setUploading]  = useState(false);
  const fileInputRef = useRef(null);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const data = await api.get('/media');
      setFiles(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadFiles(); }, []);

  const openDetail = async (file) => {
    setSelected(file);
    setUsageData(null);
    try {
      const data = await api.get(`/media/${file.id}/usage`);
      setUsageData(data);
    } catch { /* non-fatal */ }
  };

  const closeDetail = () => { setSelected(null); setUsageData(null); };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await fetch('/api/upload/media', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        body: formData
      });
      await loadFiles();
    } catch (err) {
      setError('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (file) => {
    if (!confirm(`Delete "${file.original_name || file.filename}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/media/${file.id}`);
      closeDetail();
      await loadFiles();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="media-library-page">
      <div className="qm-toolbar">
        <h2>Media Library</h2>
        <div className="qm-toolbar-actions">
          <button
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : '↑ Upload File'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleUpload}
            accept="image/*,video/*,audio/*"
          />
        </div>
      </div>

      {error && (
        <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>
          Loading media files…
        </p>
      ) : files.length === 0 ? (
        <div className="history-empty-state">
          <p className="history-empty">No media files yet.</p>
          <p className="history-empty-sub">Upload images, videos, or audio files to use them in questions and slide masters.</p>
        </div>
      ) : (
        <div className="media-grid">
          {files.map(file => (
            <button
              key={file.id}
              className={`media-card ${file.in_use ? 'media-card-in-use' : ''}`}
              onClick={() => openDetail(file)}
              title={file.original_name || file.filename}
            >
              {isImage(file) ? (
                <div className="media-thumb">
                  <img src={file.url} alt={file.original_name || file.filename} loading="lazy" />
                </div>
              ) : (
                <div className="media-thumb media-thumb-icon">
                  <FileIcon file={file} />
                </div>
              )}
              <div className="media-card-body">
                <p className="media-card-name">{file.original_name || file.filename}</p>
                <p className="media-card-meta">{formatBytes(file.size_bytes)}</p>
                <div className="media-card-chips">
                  {file.labels.map(label => (
                    <span
                      key={label}
                      className="media-usage-chip"
                      style={USAGE_CHIP_COLORS[label] || {}}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="modal modal-lg media-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selected.original_name || selected.filename}</h3>
              <button onClick={closeDetail} className="btn-close">×</button>
            </div>
            <div className="modal-body">
              {/* Preview */}
              {isImage(selected) && (
                <img
                  src={selected.url}
                  alt={selected.original_name}
                  style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, objectFit: 'contain', background: 'rgba(0,0,0,0.3)' }}
                />
              )}
              {isVideo(selected) && (
                <video src={selected.url} controls style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8 }} />
              )}
              {isAudio(selected) && (
                <audio src={selected.url} controls style={{ width: '100%' }} />
              )}

              {/* Metadata */}
              <div className="media-detail-meta">
                <div className="media-meta-row">
                  <span className="media-meta-label">Filename</span>
                  <span className="media-meta-value">{selected.filename}</span>
                </div>
                <div className="media-meta-row">
                  <span className="media-meta-label">Type</span>
                  <span className="media-meta-value">{selected.mime_type || '—'}</span>
                </div>
                <div className="media-meta-row">
                  <span className="media-meta-label">Size</span>
                  <span className="media-meta-value">{formatBytes(selected.size_bytes)}</span>
                </div>
                <div className="media-meta-row">
                  <span className="media-meta-label">Uploaded</span>
                  <span className="media-meta-value">{formatDate(selected.uploaded_at)}</span>
                </div>
                <div className="media-meta-row">
                  <span className="media-meta-label">URL</span>
                  <code className="media-meta-url">{selected.url}</code>
                </div>
              </div>

              {/* Usage section */}
              {usageData ? (
                <div className="media-usage-section">
                  <h4>Used in</h4>
                  {usageData.usage.questions.length === 0 && usageData.usage.slide_masters.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not used anywhere — safe to delete.</p>
                  ) : (
                    <>
                      {usageData.usage.questions.length > 0 && (
                        <div>
                          <p className="media-usage-group-label">Questions ({usageData.usage.questions.length})</p>
                          <ul className="media-usage-list">
                            {usageData.usage.questions.map(q => (
                              <li key={q.id} className="media-usage-item">
                                <span className="media-usage-chip" style={USAGE_CHIP_COLORS['Question']}>Q#{q.id}</span>
                                <span style={{ color: 'var(--text-primary)', fontSize: '0.88rem' }}>{q.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {usageData.usage.slide_masters.length > 0 && (
                        <div>
                          <p className="media-usage-group-label">Slide Masters ({usageData.usage.slide_masters.length})</p>
                          <ul className="media-usage-list">
                            {usageData.usage.slide_masters.map(m => (
                              <li key={m.id} className="media-usage-item">
                                <span className="media-usage-chip" style={USAGE_CHIP_COLORS['Slide Master']}>M#{m.id}</span>
                                <span style={{ color: 'var(--text-primary)', fontSize: '0.88rem' }}>{m.name}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.88rem' }}>Loading usage info…</p>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(selected)}
                disabled={selected.in_use}
                title={selected.in_use ? 'Remove from all questions and slide masters before deleting' : 'Delete this file'}
              >
                🗑 Delete
              </button>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
              >
                Open file ↗
              </a>
              <button onClick={closeDetail} className="btn btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
