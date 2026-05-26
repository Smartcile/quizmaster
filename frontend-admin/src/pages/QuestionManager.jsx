import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';

const QUESTION_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'mcq', label: 'Multiple Choice' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' }
];

const EMPTY_FORM = {
  text: '',
  answer: '',
  type: 'text',
  points: 1,
  media_url: '',
  category: '',
  options: ['', '', '', '']
};

export default function QuestionManager() {
  const [questions, setQuestions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [csvFile, setCsvFile] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [qs, cats] = await Promise.all([api.get('/questions'), api.get('/questions/categories')]);
      setQuestions(qs);
      setCategories(cats);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = useMemo(() => {
    return questions.filter(q => {
      if (filterCategory !== 'all' && q.category !== filterCategory) return false;
      if (search) {
        const s = search.toLowerCase();
        return q.text.toLowerCase().includes(s) || (q.answer || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [questions, search, filterCategory]);

  const selectQuestion = (q) => {
    setEditingId(q.id);
    setForm({
      text: q.text || '',
      answer: q.answer || '',
      type: q.type || 'text',
      points: q.points ?? 1,
      media_url: q.media_url || '',
      category: q.category || '',
      options: Array.isArray(q.options) && q.options.length ? [...q.options, '', '', '', ''].slice(0, 4) : ['', '', '', '']
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
        options: form.type === 'mcq' ? form.options.filter(o => o.trim()) : []
      };
      if (editingId) {
        await api.put(`/questions/${editingId}`, payload);
      } else {
        await api.post('/questions', payload);
      }
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

  return (
    <div className="question-manager">
      {error && <div className="error-banner" onClick={() => setError(null)}>{error} <span style={{ float: 'right' }}>✕</span></div>}

      <div className="qm-layout">
        <aside className="qm-list">
          <div className="qm-list-header">
            <h3>Questions ({filtered.length})</h3>
            <button className="btn btn-primary btn-sm" onClick={newQuestion}>+ New</button>
          </div>

          <div className="qm-filters">
            <input
              type="search"
              placeholder="🔍 Search questions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="qm-search"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="qm-category-filter"
            >
              <option value="all">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
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
                  <span className={`qm-tag qm-tag-${q.type}`}>{q.type}</span>
                  {q.category && <span className="qm-tag qm-tag-cat">{q.category}</span>}
                  <span className="qm-points">{q.points} pt</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="qm-editor">
          <div className="qm-editor-header">
            <h3>{editingId ? 'Edit Question' : 'New Question'}</h3>
            {editingId && (
              <button onClick={() => handleDelete(editingId)} className="btn btn-danger btn-sm">Delete</button>
            )}
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

            <div className="form-row">
              <label className="form-label">Type
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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

            {form.type === 'mcq' ? (
              <div className="mcq-editor">
                <label className="form-label">Options (the correct one must match the answer field below)</label>
                {form.options.map((opt, i) => (
                  <div key={i} className="mcq-option-row">
                    <span className="mcq-letter">{String.fromCharCode(65 + i)}</span>
                    <input
                      type="text"
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                    />
                  </div>
                ))}
                <label className="form-label">Correct answer (paste exact text of correct option)
                  <input
                    type="text"
                    placeholder="Paris"
                    value={form.answer}
                    onChange={(e) => setForm({ ...form, answer: e.target.value })}
                    required
                  />
                </label>
              </div>
            ) : (
              <label className="form-label">Answer
                <input
                  type="text"
                  placeholder="Paris"
                  value={form.answer}
                  onChange={(e) => setForm({ ...form, answer: e.target.value })}
                  required
                />
              </label>
            )}

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

          <div className="qm-import">
            <h4>Import CSV</h4>
            <p className="help-text">Columns: question, answer, type, points, media_url, category</p>
            <div className="csv-upload">
              <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} />
              <button onClick={handleCSVUpload} className="btn btn-secondary" disabled={!csvFile}>Upload CSV</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
