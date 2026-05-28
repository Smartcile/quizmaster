import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';

const QUESTION_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' }
];

const ANSWER_MODES = [
  { value: 'text', label: 'Text answer only' },
  { value: 'mcq', label: 'Multiple choice only' },
  { value: 'both', label: 'Both (text + MCQ)' }
];

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy', color: '#00ff9f' },
  { value: 'medium', label: 'Medium', color: '#ffe600' },
  { value: 'hard', label: 'Hard', color: '#ff3868' }
];

const QUESTION_FORMATS = [
  { value: 'standard', label: 'Standard' },
  { value: 'multichoice', label: 'Multichoice' },
  { value: 'both', label: 'Both' }
];

const EMPTY_FORM = {
  text: '',
  answer: '',
  type: 'text',
  points: 1,
  media_url: '',
  category: '',
  difficulty: 'medium',
  answer_mode: 'text',
  question_format: 'standard',
  approved: false,
  options: ['', '', '', '']
};

export default function QuestionManager() {
  const [questions, setQuestions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [filterApproved, setFilterApproved] = useState('all');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [managedCategories, setManagedCategories] = useState([]);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [qs, cats, managed] = await Promise.all([
        api.get('/questions'),
        api.get('/questions/categories'),
        api.get('/categories').catch(() => [])
      ]);
      setQuestions(qs);
      setCategories(cats);
      setManagedCategories(managed);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const reloadCategories = async () => {
    try {
      const [cats, managed] = await Promise.all([
        api.get('/questions/categories'),
        api.get('/categories').catch(() => [])
      ]);
      setCategories(cats);
      setManagedCategories(managed);
    } catch (err) { /* swallow */ }
  };

  const filtered = useMemo(() => {
    return questions.filter(q => {
      if (filterCategory !== 'all' && q.category !== filterCategory) return false;
      if (filterDifficulty !== 'all' && (q.difficulty || 'medium') !== filterDifficulty) return false;
      if (filterApproved === 'approved' && !q.approved) return false;
      if (filterApproved === 'unapproved' && q.approved) return false;
      if (search) {
        const s = search.toLowerCase();
        return q.text.toLowerCase().includes(s) || (q.answer || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [questions, search, filterCategory, filterDifficulty, filterApproved]);

  const selectQuestion = (q) => {
    setEditingId(q.id);
    setForm({
      text: q.text || '',
      answer: q.answer || '',
      type: q.type || 'text',
      points: q.points ?? 1,
      media_url: q.media_url || '',
      category: q.category || '',
      difficulty: q.difficulty || 'medium',
      answer_mode: q.answer_mode || (q.type === 'mcq' ? 'mcq' : 'text'),
      question_format: q.question_format || 'standard',
      approved: q.approved ?? false,
      options: Array.isArray(q.options) && q.options.length ? [...q.options] : ['', '', '', '']
    });
  };

  const newQuestion = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        options: (form.answer_mode === 'mcq' || form.answer_mode === 'both') ? form.options.filter(o => o.trim()) : []
      };
      if (editingId) await api.put(`/questions/${editingId}`, payload);
      else await api.post('/questions', payload);
      await loadAll();
      newQuestion();
    } catch (err) {
      setError('Save failed: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this question?')) return;
    try {
      await api.delete(`/questions/${id}`);
      if (editingId === id) newQuestion();
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCSVUpload = async () => {
    if (!csvFile) return;
    const formData = new FormData();
    formData.append('file', csvFile);
    try {
      await api.upload('/upload/csv', formData);
      alert('CSV uploaded. Reloading...');
      setCsvFile(null);
      setCsvOpen(false);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const updateOption = (i, value) => {
    const opts = [...form.options];
    opts[i] = value;
    setForm({ ...form, options: opts });
  };

  const addOption = () => {
    setForm(f => ({ ...f, options: [...f.options, ''] }));
  };

  const removeOption = (i) => {
    if (form.options.length <= 2) return; // minimum 2 options
    setForm(f => ({ ...f, options: f.options.filter((_, idx) => idx !== i) }));
  };

  const showMcq = form.answer_mode === 'mcq' || form.answer_mode === 'both';

  return (
    <div className="question-manager">
      <div className="qm-toolbar">
        <h2>Question Database</h2>
        <div className="qm-toolbar-actions">
          <button
            onClick={() => window.open('/api/questions/export', '_blank')}
            className="btn btn-primary btn-sm"
            title="Download all questions as CSV"
          >
            ↓ Download CSV
          </button>
          <button onClick={() => setCsvOpen(true)} className="btn btn-secondary btn-sm" title="Import CSV">
            📁 Import CSV
          </button>
          <button onClick={() => setCatManagerOpen(true)} className="btn btn-secondary btn-sm" title="Manage categories">
            🏷 Categories
          </button>
        </div>
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

      <div className="qm-layout">
        <aside className="qm-list">
          <div className="qm-list-header">
            <h3>Questions ({filtered.length})</h3>
            <button className="btn btn-primary btn-sm" onClick={newQuestion}>+ New</button>
          </div>

          <div className="qm-filters">
            <input
              type="search"
              placeholder="🔍 Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="qm-search"
            />
            <div className="qm-filter-row">
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="all">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)}>
                <option value="all">All difficulties</option>
                {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <select value={filterApproved} onChange={(e) => setFilterApproved(e.target.value)}>
                <option value="all">All status</option>
                <option value="approved">Approved</option>
                <option value="unapproved">Unapproved</option>
              </select>
            </div>
          </div>

          <div className="qm-question-list">
            {filtered.length === 0 ? (
              <p className="qm-empty">No questions match.</p>
            ) : filtered.map(q => (
              <div
                key={q.id}
                className={`qm-question-item ${editingId === q.id ? 'active' : ''}`}
                onClick={() => selectQuestion(q)}
              >
                <div className="qm-question-text">{q.text}</div>
                <div className="qm-question-meta">
                  {q.approved && <span className="qm-approved" title="Approved">✓</span>}
                  <DifficultyBadge value={q.difficulty || 'medium'} />
                  <FormatBadge value={q.question_format || 'standard'} />
                  <span className={`qm-tag qm-tag-${q.answer_mode || 'text'}`}>{q.answer_mode || 'text'}</span>
                  {q.category && <span className="qm-tag qm-tag-cat">{q.category}</span>}
                  <span className="qm-points">{q.points} pt</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="qm-editor qm-editor-scrollable">
          <div className="qm-editor-header">
            <h3>{editingId ? 'Edit Question' : 'New Question'}</h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {editingId && (
                <button onClick={() => handleDelete(editingId)} className="btn btn-danger btn-sm">Delete</button>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="form">
            <label className="form-label">Question text
              <textarea
                placeholder="What's the capital of France?"
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                rows={3}
                required
              />
            </label>

            <div className="form-row form-row-3">
              <label className="form-label">Media type
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>

              <label className="form-label">Difficulty
                <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                  {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </label>

              <label className="form-label">Points
                <input
                  type="number"
                  value={form.points}
                  onChange={(e) => setForm({ ...form, points: parseFloat(e.target.value) || 1 })}
                  min="0"
                  step="0.5"
                />
              </label>
            </div>

            <div className="form-row form-row-3">
              <label className="form-label">Answer mode
                <select value={form.answer_mode} onChange={(e) => setForm({ ...form, answer_mode: e.target.value })}>
                  {ANSWER_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>

              <label className="form-label">Format
                <select value={form.question_format} onChange={(e) => setForm({ ...form, question_format: e.target.value })}>
                  {QUESTION_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>

              <label className="form-label">Category
                <input
                  type="text"
                  placeholder="Geography"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  list="category-list"
                />
                <datalist id="category-list">
                  {categories.map(c => <option key={c} value={c} />)}
                </datalist>
              </label>
            </div>

            <label className={`approved-toggle ${form.approved ? 'is-approved' : ''}`}>
              <input
                type="checkbox"
                checked={form.approved}
                onChange={(e) => setForm({ ...form, approved: e.target.checked })}
              />
              {form.approved ? '✓ Approved for use in quizzes' : 'Not yet approved — check to approve'}
            </label>

            {showMcq && (
              <div className="mcq-editor">
                <div className="mcq-editor-header">
                  <label className="form-label" style={{ margin: 0 }}>Multiple choice options</label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm mcq-add-btn"
                    onClick={addOption}
                  >
                    + Add Option
                  </button>
                </div>
                {form.options.map((opt, i) => (
                  <div key={i} className="mcq-option-row">
                    <span className="mcq-letter">{String.fromCharCode(65 + i)}</span>
                    <input
                      type="text"
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="mcq-remove-btn"
                      onClick={() => removeOption(i)}
                      disabled={form.options.length <= 2}
                      title={form.options.length <= 2 ? 'Need at least 2 options' : 'Remove option'}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="form-label">
              {showMcq ? 'Correct answer (exact text of the correct option)' : 'Answer'}
              <input
                type="text"
                placeholder="Paris"
                value={form.answer}
                onChange={(e) => setForm({ ...form, answer: e.target.value })}
                required
              />
            </label>

            {['image', 'video', 'audio'].includes(form.type) && (
              <label className="form-label">Media URL
                <input
                  type="text"
                  placeholder="https://... or /uploads/..."
                  value={form.media_url}
                  onChange={(e) => setForm({ ...form, media_url: e.target.value })}
                />
              </label>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Update Question' : 'Add Question'}
              </button>
              {editingId && (
                <button type="button" onClick={newQuestion} className="btn btn-secondary">Cancel</button>
              )}
            </div>
          </form>
        </section>
      </div>

      {csvOpen && (
        <div className="modal-overlay" onClick={() => setCsvOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import Questions from CSV</h3>
              <button onClick={() => setCsvOpen(false)} className="btn-close">×</button>
            </div>
            <div className="modal-body">
              <p className="help-text">Columns: question, answer, type, points, media_url, category, difficulty, answer_mode</p>
              <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} />
              {csvFile && <p className="help-text">📁 {csvFile.name}</p>}
            </div>
            <div className="modal-footer">
              <button onClick={() => setCsvOpen(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={handleCSVUpload} className="btn btn-primary" disabled={!csvFile}>Upload</button>
            </div>
          </div>
        </div>
      )}

      {catManagerOpen && (
        <CategoriesModal
          categories={managedCategories}
          onClose={() => setCatManagerOpen(false)}
          onChanged={reloadCategories}
          onError={setError}
        />
      )}
    </div>
  );
}

// ── Manage Categories modal ─────────────────────────────────────────────────
// Lists managed categories with inline rename + delete, plus an add form at
// the top. Renaming updates every question that referenced the old name.
// Deleting clears the category from any questions that referenced it (the
// questions themselves are kept).
function CategoriesModal({ categories, onClose, onChanged, onError }) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const add = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post('/categories', { name });
      setNewName('');
      onChanged();
    } catch (err) { onError(err.message); }
  };

  const beginEdit = (cat) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
  };

  const saveEdit = async (cat) => {
    const name = editingName.trim();
    if (!name || name === cat.name) { setEditingId(null); return; }
    try {
      await api.put(`/categories/${cat.id}`, { name });
      setEditingId(null);
      onChanged();
    } catch (err) { onError(err.message); }
  };

  const remove = async (cat) => {
    if (!confirm(`Delete category "${cat.name}"?\n\nQuestions using this category will not be deleted — they'll just lose this category label.`)) return;
    try {
      await api.delete(`/categories/${cat.id}`);
      onChanged();
    } catch (err) { onError(err.message); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Manage Categories</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>

        <div className="modal-body">
          <form onSubmit={add} className="cat-add-form">
            <input
              type="text"
              placeholder="New category name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!newName.trim()}>
              + Add
            </button>
          </form>

          {categories.length === 0 ? (
            <p className="help-text">No categories yet.</p>
          ) : (
            <ul className="cat-list">
              {categories.map((cat) => (
                <li key={cat.id} className="cat-row">
                  {editingId === cat.id ? (
                    <>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                      />
                      <button onClick={() => saveEdit(cat)} className="btn btn-primary btn-sm">Save</button>
                      <button onClick={() => setEditingId(null)} className="btn btn-secondary btn-sm">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="cat-name">{cat.name}</span>
                      <button onClick={() => beginEdit(cat)} className="btn btn-secondary btn-sm">Rename</button>
                      <button onClick={() => remove(cat)} className="btn btn-danger btn-sm">Delete</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}

function DifficultyBadge({ value }) {
  const d = DIFFICULTIES.find(x => x.value === value) || DIFFICULTIES[1];
  return <span className={`qm-difficulty qm-difficulty-${value}`}>{d.label}</span>;
}

function FormatBadge({ value }) {
  const labels = { standard: 'STD', multichoice: 'MCQ', both: 'BOTH' };
  return <span className={`qm-tag qm-tag-fmt-${value || 'standard'}`}>{labels[value] || 'STD'}</span>;
}
