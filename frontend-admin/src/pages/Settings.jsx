import { useState, useEffect } from 'react';
import { api } from '../services/api';

// Settings is a container of collapsible sections so more can be added later.
export default function Settings() {
  const [error, setError] = useState(null);

  return (
    <div className="settings-page">
      <div className="qm-toolbar">
        <h2>Settings</h2>
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

      <CollapsibleSection title="Question Repositories" subtitle="Pull questions & answers from GitHub CSV repos" defaultOpen>
        <QuestionRepos onError={setError} />
      </CollapsibleSection>
    </div>
  );
}

// ── Generic expand/contract section ──────────────────────────────────────────
function CollapsibleSection({ title, subtitle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`settings-section ${open ? 'open' : ''}`}>
      <button className="settings-section-header" onClick={() => setOpen(o => !o)}>
        <span className="settings-chevron">{open ? '▾' : '▸'}</span>
        <span className="settings-section-title">{title}</span>
        {subtitle && <span className="settings-section-sub">{subtitle}</span>}
      </button>
      {open && <div className="settings-section-body">{children}</div>}
    </div>
  );
}

// ── Question repositories ────────────────────────────────────────────────────
function QuestionRepos({ onError }) {
  const [repos, setRepos]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [addOpen, setAddOpen]   = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [syncingId, setSyncingId]   = useState(null);
  const [results, setResults]   = useState({}); // repoId -> summary | { error }

  const load = async () => {
    setLoading(true);
    try {
      setRepos(await api.get('/repos'));
    } catch (err) {
      onError('Could not load repositories: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const addRepo = async (payload) => {
    try {
      await api.post('/repos', payload);
      setAddOpen(false);
      await load();
    } catch (err) {
      onError('Add failed: ' + err.message);
    }
  };

  const syncRepo = async (id) => {
    setSyncingId(id);
    setResults(prev => ({ ...prev, [id]: null }));
    try {
      const summary = await api.post(`/repos/${id}/sync`, {});
      setResults(prev => ({ ...prev, [id]: summary }));
      setExpandedId(id);
      await load();
    } catch (err) {
      setResults(prev => ({ ...prev, [id]: { error: err.message } }));
      setExpandedId(id);
    } finally {
      setSyncingId(null);
    }
  };

  const deleteRepo = async (id, label) => {
    if (!confirm(`Remove repository "${label}"?\n\nQuestions already imported from it stay in your bank — this only removes the link.`)) return;
    try {
      await api.delete(`/repos/${id}`);
      await load();
    } catch (err) {
      onError('Delete failed: ' + err.message);
    }
  };

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'never';

  return (
    <div className="repos">
      <div className="repos-toolbar">
        <p className="help-text" style={{ margin: 0 }}>
          Add a public GitHub repo containing question CSVs (same columns as Download/Import CSV).
          Syncing imports new questions and labels shared ones <strong>L&amp;R</strong> — nothing is duplicated.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>+ Add repository</button>
      </div>

      {loading ? (
        <p className="help-text">Loading…</p>
      ) : repos.length === 0 ? (
        <p className="help-text">No repositories yet. Add one to pull in a question pack.</p>
      ) : (
        <ul className="repo-list">
          {repos.map(r => {
            const isOpen = expandedId === r.id;
            const result = results[r.id];
            return (
              <li key={r.id} className="repo-item">
                <div className="repo-row">
                  <button className="repo-main" onClick={() => setExpandedId(isOpen ? null : r.id)}>
                    <span className="settings-chevron">{isOpen ? '▾' : '▸'}</span>
                    <span className="repo-label">{r.label}</span>
                    <span className="repo-sub">{r.owner}/{r.repo}{r.path ? ` · ${r.path}` : ''}</span>
                  </button>
                  <div className="repo-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => syncRepo(r.id)}
                      disabled={syncingId === r.id}
                    >
                      {syncingId === r.id ? 'Syncing…' : '⟳ Sync'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteRepo(r.id, r.label)}>🗑</button>
                  </div>
                </div>

                {isOpen && (
                  <div className="repo-detail">
                    <div className="repo-meta-row"><span>URL</span><code>{r.url}</code></div>
                    <div className="repo-meta-row"><span>Branch</span><code>{r.branch || 'main'}</code></div>
                    <div className="repo-meta-row"><span>Path</span><code>{r.path || '(repo root)'}</code></div>
                    <div className="repo-meta-row"><span>Last synced</span><code>{fmtDate(r.last_synced_at)}</code></div>

                    {result && result.error && (
                      <div className="repo-result repo-result-err">⚠ {result.error}</div>
                    )}
                    {result && !result.error && (
                      <div className="repo-result repo-result-ok">
                        ✓ Synced {result.files} file{result.files !== 1 ? 's' : ''} —
                        {' '}<strong>{result.added}</strong> added,
                        {' '}<strong>{result.relabeled}</strong> labelled L&amp;R,
                        {' '}<strong>{result.ignored}</strong> already present.
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {addOpen && <AddRepoModal onAdd={addRepo} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ── Add repository popup ──────────────────────────────────────────────────────
function AddRepoModal({ onAdd, onClose }) {
  const [url, setUrl]       = useState('');
  const [label, setLabel]   = useState('');
  const [branch, setBranch] = useState('');
  const [path, setPath]     = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    onAdd({ url: url.trim(), label: label.trim(), branch: branch.trim(), path: path.trim() });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add question repository</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <label className="form-label">GitHub URL
              <input
                type="text"
                placeholder="https://github.com/owner/repo/tree/main/question-packs"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
                required
              />
            </label>
            <p className="help-text">
              Point at a repo, a folder of CSVs, or a single <code>.csv</code> file. A <code>/tree/branch/path</code>
              {' '}or <code>raw.githubusercontent.com</code> link is detected automatically — or fill the fields below.
            </p>
            <label className="form-label">Label (optional)
              <input type="text" placeholder="General Knowledge Pack" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <div className="form-row">
              <label className="form-label">Branch (optional)
                <input type="text" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
              </label>
              <label className="form-label">Path (optional)
                <input type="text" placeholder="question-packs" value={path} onChange={(e) => setPath(e.target.value)} />
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!url.trim()}>Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}
