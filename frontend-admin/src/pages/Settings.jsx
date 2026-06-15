import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { getTestSettings, saveTestSettings, DEFAULT_TEST_SETTINGS } from '../utils/testSettings';

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

      <CollapsibleSection title="Quiz Control & Testing" subtitle="Bots, embedded previews and test-run cleanup">
        <QuizControlSettings />
      </CollapsibleSection>
    </div>
  );
}

// ── Quiz Control & Testing settings ───────────────────────────────────────────
function QuizControlSettings() {
  const [s, setS]       = useState(getTestSettings);
  const [saved, setSaved] = useState(false);

  const update = (patch) => { setS(prev => ({ ...prev, ...patch })); setSaved(false); };
  const updateBot = (i, patch) =>
    update({ bots: s.bots.map((b, idx) => idx === i ? { ...b, ...patch } : b) });
  const addBot = () =>
    update({ bots: [...s.bots, { name: `Bot Team ${s.bots.length + 1}`, size: 4, correct: 0.6, wrong: 0.2 }] });
  const removeBot = (i) => update({ bots: s.bots.filter((_, idx) => idx !== i) });

  const save = () => { saveTestSettings(s); setSaved(true); };
  const reset = () => { setS(JSON.parse(JSON.stringify(DEFAULT_TEST_SETTINGS))); setSaved(false); };

  const pct = (v) => Math.round((Number(v) || 0) * 100);
  const skip = (b) => Math.max(0, 100 - pct(b.correct) - pct(b.wrong));

  return (
    <div className="qc-settings">
      <p className="help-text" style={{ marginTop: 0 }}>
        These control the <strong>Test Quiz</strong> runner (bots, embedded previews) and apply when you
        click 🧪 Test Quiz on the Dashboard. Stored in this browser.
      </p>

      {/* Bots */}
      <div className="qc-block">
        <div className="qc-block-head">
          <h4>Bot teams</h4>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addBot}>+ Add bot</button>
        </div>
        <div className="qc-bots-head">
          <span>Name</span><span>Size</span><span>Correct %</span><span>Wrong %</span><span>Skip %</span><span></span>
        </div>
        {s.bots.map((b, i) => (
          <div className="qc-bot-row" key={i}>
            <input type="text" value={b.name} onChange={e => updateBot(i, { name: e.target.value })} />
            <input type="number" min="1" max="20" value={b.size}
                   onChange={e => updateBot(i, { size: parseInt(e.target.value) || 1 })} />
            <input type="number" min="0" max="100" value={pct(b.correct)}
                   onChange={e => updateBot(i, { correct: (parseInt(e.target.value) || 0) / 100 })} />
            <input type="number" min="0" max="100" value={pct(b.wrong)}
                   onChange={e => updateBot(i, { wrong: (parseInt(e.target.value) || 0) / 100 })} />
            <span className="qc-skip">{skip(b)}%</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeBot(i)}
                    disabled={s.bots.length <= 1} title={s.bots.length <= 1 ? 'At least one bot' : 'Remove'}>×</button>
          </div>
        ))}
      </div>

      {/* Preview layout + surfaces + quizzer mode */}
      <div className="qc-block qc-block-grid">
        <div>
          <h4>Preview layout</h4>
          <label className="qc-radio">
            <input type="radio" name="qc-layout" checked={s.layout === 'side-by-side'}
                   onChange={() => update({ layout: 'side-by-side' })} /> Side by side
          </label>
          <label className="qc-radio">
            <input type="radio" name="qc-layout" checked={s.layout === 'stacked'}
                   onChange={() => update({ layout: 'stacked' })} /> Stacked
          </label>
        </div>
        <div>
          <h4>Surfaces to embed</h4>
          <label className="qc-check">
            <input type="checkbox" checked={s.surfaces.slideshow}
                   onChange={e => update({ surfaces: { ...s.surfaces, slideshow: e.target.checked } })} /> Slideshow
          </label>
          <label className="qc-check">
            <input type="checkbox" checked={s.surfaces.quizzer}
                   onChange={e => update({ surfaces: { ...s.surfaces, quizzer: e.target.checked } })} /> Quizzer
          </label>
        </div>
        <div>
          <h4>Quizzer pane default</h4>
          <label className="qc-radio">
            <input type="radio" name="qc-qmode" checked={s.quizzerMode === 'mirror'}
                   onChange={() => update({ quizzerMode: 'mirror' })} /> Mirror a bot
          </label>
          <label className="qc-radio">
            <input type="radio" name="qc-qmode" checked={s.quizzerMode === 'interactive'}
                   onChange={() => update({ quizzerMode: 'interactive' })} /> Interactive (you join)
          </label>
        </div>
      </div>

      {/* Cleanup */}
      <div className="qc-block">
        <label className="qc-check">
          <input type="checkbox" checked={s.autoCleanTest}
                 onChange={e => update({ autoCleanTest: e.target.checked })} />
          Auto-clean test sessions on close (delete the run + its bot teams/answers)
        </label>
        <p className="help-text" style={{ marginTop: 4 }}>
          Live sessions are never auto-deleted — only test runs.
        </p>
      </div>

      <div className="qc-actions">
        <button type="button" className="btn btn-primary" onClick={save}>Save settings</button>
        <button type="button" className="btn btn-secondary" onClick={reset}>Reset to defaults</button>
        {saved && <span className="qc-saved">✓ Saved</span>}
      </div>
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
  const [editRepo, setEditRepo] = useState(null); // repo being edited, or null
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

  const saveRepo = async (id, payload) => {
    try {
      await api.put(`/repos/${id}`, payload);
      setEditRepo(null);
      await load();
    } catch (err) {
      onError('Save failed: ' + err.message);
    }
  };

  const syncRepo = async (id, apply = false) => {
    setSyncingId(id);
    setResults(prev => ({ ...prev, [id]: null }));
    try {
      const summary = await api.post(`/repos/${id}/sync`, { apply });
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
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditRepo(r)}>✏ Edit</button>
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
                        {' '}<strong>{result.ignored}</strong> unchanged
                        {result.updated ? <>, <strong>{result.updated}</strong> updated</> : null}
                        {result.changed?.length ? <>, <strong>{result.changed.length}</strong> changed</> : null}.

                        {result.changed?.length > 0 && (
                          <div className="repo-changed">
                            <p className="repo-changed-title">
                              ⚠ {result.changed.length} repo question{result.changed.length !== 1 ? 's' : ''} changed since import:
                            </p>
                            <ul className="repo-changed-list">
                              {result.changed.slice(0, 25).map(c => <li key={c.id}>{c.text}</li>)}
                              {result.changed.length > 25 && <li>…and {result.changed.length - 25} more</li>}
                            </ul>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => syncRepo(r.id, true)}
                              disabled={syncingId === r.id}
                            >
                              {syncingId === r.id ? 'Applying…' : `Apply ${result.changed.length} update${result.changed.length !== 1 ? 's' : ''}`}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {addOpen && <RepoModal onSubmit={addRepo} onClose={() => setAddOpen(false)} />}
      {editRepo && (
        <RepoModal
          repo={editRepo}
          onSubmit={(payload) => saveRepo(editRepo.id, payload)}
          onClose={() => setEditRepo(null)}
        />
      )}
    </div>
  );
}

// ── Add / edit repository popup ───────────────────────────────────────────────
function RepoModal({ repo, onSubmit, onClose }) {
  const editing = !!repo;
  const [url, setUrl]       = useState(repo?.url || '');
  const [label, setLabel]   = useState(repo?.label || '');
  const [branch, setBranch] = useState(repo?.branch || '');
  const [path, setPath]     = useState(repo?.path || '');

  const submit = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({ url: url.trim(), label: label.trim(), branch: branch.trim(), path: path.trim() });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editing ? 'Edit repository' : 'Add question repository'}</h3>
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
            <button type="submit" className="btn btn-primary" disabled={!url.trim()}>{editing ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
