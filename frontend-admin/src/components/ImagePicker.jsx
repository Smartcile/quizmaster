import { useState, useEffect } from 'react';
import { api } from '../services/api';

/**
 * Modal image picker that browses question media already in the DB.
 * Does not allow arbitrary uploads — images come from the question bank only.
 *
 * Props:
 *   onPick(url: string) — called with the media_url of the chosen image
 *   onClose()           — called when dismissed without picking
 */
export default function ImagePicker({ onPick, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/questions')
      .then(qs => {
        // Only questions that have a media_url stored (image / video / audio types)
        setItems(qs.filter(q => q.media_url && q.media_url.trim()));
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter(q =>
    !search || q.text.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg ip-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Media Library</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>

        <div className="modal-body">
          <input
            type="search"
            placeholder="🔍 Filter by question text…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 14 }}
          />

          {loading && <p className="qm-empty">Loading media…</p>}

          {!loading && filtered.length === 0 && (
            <p className="qm-empty">
              {items.length === 0
                ? 'No media found. Add questions with Image type and a media URL first.'
                : 'No results for that search.'}
            </p>
          )}

          {!loading && filtered.length > 0 && (
            <div className="ip-grid">
              {filtered.map(q => (
                <button
                  key={q.id}
                  className="ip-grid-item"
                  type="button"
                  onClick={() => { onPick(q.media_url); onClose(); }}
                  title={q.text}
                >
                  <div className="ip-thumb">
                    <img
                      src={q.media_url}
                      alt={q.text}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  <p className="ip-label">{q.text}</p>
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
