import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import ImageCropEditor from '../components/ImageCropEditor';
import AudioEditor from '../components/AudioEditor';
import VideoEditor from '../components/VideoEditor';

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

// Friendly name shown in the library — never the real filename/url, which stay
// fixed so references don't break.
const displayName = (f) => f.display_name || f.original_name || f.filename;

export default function MediaLibrary() {
  const [files,      setFiles]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [selected,   setSelected]   = useState(null);   // file object for detail modal
  const [usageData,  setUsageData]  = useState(null);   // { file, usage }
  const [uploading,  setUploading]  = useState(false);
  const [editor,     setEditor]     = useState(null);   // { kind: 'image'|'audio', file }
  const [folderFilter, setFolderFilter] = useState('all'); // 'all' | '__unfiled__' | <name>
  const [editName,   setEditName]   = useState('');
  const [editFolder, setEditFolder] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editTitle,  setEditTitle]  = useState('');
  const [editAlbum,  setEditAlbum]  = useState('');
  const [editLyrics, setEditLyrics] = useState('');
  const [lyricsSynced, setLyricsSynced] = useState(false);
  const [fetchingLyrics, setFetchingLyrics] = useState(false);
  const fileInputRef = useRef(null);

  // Virtual folders derived from the loaded files
  const folders = [...new Set(files.map(f => f.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visibleFiles = files.filter(f =>
    folderFilter === 'all' ? true :
    folderFilter === '__unfiled__' ? !f.folder :
    f.folder === folderFilter
  );

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
    setEditName(displayName(file));
    setEditFolder(file.folder || '');
    setEditArtist(file.artist || '');
    setEditTitle(file.title || '');
    setEditAlbum(file.album || '');
    setEditLyrics(file.lyrics || '');
    setLyricsSynced(!!file.lyrics_synced);
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

  const handleEdited = async () => {
    // A new file was produced — refresh the grid and close both modals.
    setEditor(null);
    closeDetail();
    await loadFiles();
  };

  // Fetch synced lyrics from LRCLIB using the (possibly just-edited) artist/title.
  const fetchLyrics = async () => {
    if (!selected) return;
    setFetchingLyrics(true);
    try {
      const updated = await api.post(`/media/${selected.id}/fetch-lyrics`, {
        artist: editArtist.trim(), title: editTitle.trim()
      });
      setSelected(s => ({ ...s, ...updated }));
      setFiles(prev => prev.map(f => f.id === updated.id ? { ...f, ...updated } : f));
      setEditLyrics(updated.lyrics || '');
      setLyricsSynced(!!updated.lyrics_synced);
    } catch (err) {
      setError(err.message.replace(/^\d+:\s*/, ''));
    } finally {
      setFetchingLyrics(false);
    }
  };

  // Save the friendly name + virtual folder (display only — file/url untouched).
  const saveMeta = async () => {
    if (!selected) return;
    try {
      const body = { display_name: editName.trim(), folder: editFolder.trim() };
      if (isAudio(selected)) {
        body.artist = editArtist.trim();
        body.title = editTitle.trim();
        body.album = editAlbum.trim();
        body.lyrics = editLyrics;
        body.lyrics_synced = lyricsSynced;
      }
      const updated = await api.put(`/media/${selected.id}`, body);
      setSelected(s => ({ ...s, ...updated }));
      setFiles(prev => prev.map(f => f.id === updated.id ? { ...f, ...updated } : f));
    } catch (err) {
      setError(err.message.replace(/^\d+:\s*/, ''));
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
          <select
            className="media-folder-filter"
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            title="Filter by folder"
          >
            <option value="all">📂 All folders</option>
            <option value="__unfiled__">Unfiled</option>
            {folders.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
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
          {visibleFiles.map(file => (
            <button
              key={file.id}
              className={`media-card ${file.in_use ? 'media-card-in-use' : ''}`}
              onClick={() => openDetail(file)}
              title={displayName(file)}
            >
              {isImage(file) ? (
                <div className="media-thumb">
                  <img src={file.url} alt={displayName(file)} loading="lazy" />
                </div>
              ) : (
                <div className="media-thumb media-thumb-icon">
                  <FileIcon file={file} />
                </div>
              )}
              <div className="media-card-body">
                <p className="media-card-name">{displayName(file)}</p>
                <p className="media-card-meta">{formatBytes(file.size_bytes)}{file.folder ? ` · 📂 ${file.folder}` : ''}</p>
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
              <h3>{displayName(selected)}</h3>
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

              {/* Rename + move (display only — file/url untouched) */}
              <div className="media-rename-row">
                <label className="form-label" style={{ flex: 2 }}>Name
                  <input type="text" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Friendly name" />
                </label>
                <label className="form-label" style={{ flex: 1 }}>Folder
                  <input type="text" list="media-folders-dl" value={editFolder} onChange={e => setEditFolder(e.target.value)} placeholder="(unfiled)" />
                  <datalist id="media-folders-dl">{folders.map(f => <option key={f} value={f} />)}</datalist>
                </label>
                <button className="btn btn-primary btn-sm" onClick={saveMeta}>Save</button>
              </div>

              {/* Audio metadata — drives song matching, lyrics + auto-scoring */}
              {isAudio(selected) && (
                <div className="media-rename-row">
                  <label className="form-label" style={{ flex: 1 }}>Artist
                    <input type="text" value={editArtist} onChange={e => setEditArtist(e.target.value)} placeholder="Artist" />
                  </label>
                  <label className="form-label" style={{ flex: 1 }}>Song title
                    <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Song title" />
                  </label>
                  <label className="form-label" style={{ flex: 1 }}>Album
                    <input type="text" value={editAlbum} onChange={e => setEditAlbum(e.target.value)} placeholder="Album (optional)" />
                  </label>
                </div>
              )}

              {/* Lyrics — fetched from LRCLIB or pasted; LRC (timed) drives karaoke scrubbing */}
              {isAudio(selected) && (
                <div className="media-lyrics-row">
                  <div className="media-lyrics-head">
                    <span className="form-label" style={{ margin: 0 }}>
                      Lyrics {lyricsSynced ? <em className="lyrics-badge synced">⏱ timed (LRC)</em>
                              : editLyrics ? <em className="lyrics-badge plain">plain</em> : ''}
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={fetchLyrics} disabled={fetchingLyrics}>
                      {fetchingLyrics ? 'Fetching…' : '🎤 Fetch lyrics (LRCLIB)'}
                    </button>
                  </div>
                  <textarea
                    className="media-lyrics-text"
                    rows={6}
                    value={editLyrics}
                    onChange={e => setEditLyrics(e.target.value)}
                    placeholder="Paste lyrics, or fetch from LRCLIB by artist + title. Timed (LRC) lines look like [00:12.34] words. Press Save to keep."
                  />
                  <label className="qc-check" style={{ marginTop: 4 }}>
                    <input type="checkbox" checked={lyricsSynced} onChange={e => setLyricsSynced(e.target.checked)} />
                    These are timed (LRC) lyrics
                  </label>
                </div>
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
              {isImage(selected) && (
                <button className="btn btn-secondary" onClick={() => setEditor({ kind: 'image', file: selected })}>
                  ✂ Crop / resize
                </button>
              )}
              {isAudio(selected) && (
                <button className="btn btn-secondary" onClick={() => setEditor({ kind: 'audio', file: selected })}>
                  ✂ Edit audio
                </button>
              )}
              {isVideo(selected) && (
                <button className="btn btn-secondary" onClick={() => setEditor({ kind: 'video', file: selected })}>
                  ✂ Trim video
                </button>
              )}
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

      {editor?.kind === 'image' && (
        <ImageCropEditor file={editor.file} onClose={() => setEditor(null)} onSaved={handleEdited} />
      )}
      {editor?.kind === 'audio' && (
        <AudioEditor file={editor.file} onClose={() => setEditor(null)} onSaved={handleEdited} />
      )}
      {editor?.kind === 'video' && (
        <VideoEditor file={editor.file} onClose={() => setEditor(null)} onSaved={handleEdited} />
      )}
    </div>
  );
}
