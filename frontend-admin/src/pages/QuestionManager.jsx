import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import MediaPicker from '../components/MediaPicker';

// Map an uploaded file's MIME type to a question media type.
const mimeToType = (mime) =>
  /^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'image';

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

// A fresh Who/What Am I starts with three clues on a descending scale.
const defaultClues = () => [
  { text: '', points: 3 },
  { text: '', points: 2 },
  { text: '', points: 1 }
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
  options: ['', '', '', ''],
  is_whoami: false,
  clues: defaultClues()
};

// Duplicate-detection key: accent/punctuation/quote/dash-insensitive so that
// "Café — São!" and "Cafe - Sao" are treated as the same question (stops the
// import making copies when special characters differ).
const normText = (s) => String(s ?? '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
  .toLowerCase()
  .replace(/[–—−-]/g, ' ')              // dashes → space
  .replace(/[^\p{L}\p{N} ]/gu, ' ')                    // drop other punctuation/quotes
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^the\s+/, '');

// Tidy text for STORAGE on import: normalise Unicode + convert smart quotes,
// dashes and ellipses to plain ASCII, but KEEP accents (é stays é).
const cleanText = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[‘’‚‛′]/g, "'")
  .replace(/[“”„″]/g, '"')
  .replace(/[–—−]/g, '-')
  .replace(/…/g, '...')
  .replace(/ /g, ' ')
  .trim();

// Minimal RFC-4180-ish CSV parser: handles quoted fields, "" escapes, CR/LF.
function parseCSVRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

// Header-driven map of CSV rows → question objects. Matches the export format;
// the `options` column is pipe-separated ("a|b|c"). Column order/subset is
// flexible because everything is keyed off the header names.
function csvToQuestions(text) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const textCol = idx('question') !== -1 ? idx('question') : idx('text');
  const cell = (cells, name) => { const i = idx(name); return i === -1 ? '' : (cells[i] ?? '').trim(); };
  return rows.slice(1).map(cells => {
    const opts = cell(cells, 'options');
    return {
      text: textCol === -1 ? '' : (cells[textCol] ?? '').trim(),
      answer: cell(cells, 'answer'),
      type: cell(cells, 'type') || 'text',
      points: parseFloat(cell(cells, 'points')) || 1,
      media_url: cell(cells, 'media_url'),
      category: cell(cells, 'category'),
      difficulty: cell(cells, 'difficulty') || 'medium',
      answer_mode: cell(cells, 'answer_mode') || 'text',
      question_format: cell(cells, 'question_format') || 'standard',
      approved: cell(cells, 'approved').toLowerCase() === 'true',
      options: opts ? opts.split('|').map(o => o.trim()).filter(Boolean) : []
    };
  }).filter(q => q.text);
}

export default function QuestionManager() {
  const [questions, setQuestions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [filterApproved, setFilterApproved] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterAnswerMode, setFilterAnswerMode] = useState('all');
  const [filterKind, setFilterKind] = useState('all'); // all | standard | whoami
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [managedCategories, setManagedCategories] = useState([]);
  // Duplicate-aware import state
  const [importDupes, setImportDupes]   = useState([]); // [{ question, existingId, existingText }]
  const [importNew, setImportNew]       = useState([]); // [{ question }]
  const [resolveOpen, setResolveOpen]   = useState(false);
  const [successSummary, setSuccessSummary] = useState(null);
  const [importing, setImporting]       = useState(false);

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
      if (filterKind === 'standard' && q.is_whoami) return false;
      if (filterKind === 'whoami' && !q.is_whoami) return false;
      if (filterCategory !== 'all' && q.category !== filterCategory) return false;
      if (filterDifficulty !== 'all' && (q.difficulty || 'medium') !== filterDifficulty) return false;
      if (filterType !== 'all' && (q.type || 'text') !== filterType) return false;
      if (filterAnswerMode !== 'all' && (q.answer_mode || 'text') !== filterAnswerMode) return false;
      if (filterApproved === 'approved' && !q.approved) return false;
      if (filterApproved === 'unapproved' && q.approved) return false;
      if (search) {
        const s = search.toLowerCase();
        return q.text.toLowerCase().includes(s) || (q.answer || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [questions, search, filterCategory, filterDifficulty, filterType, filterAnswerMode, filterApproved, filterKind]);

  const selectQuestion = (q) => {
    setEditingId(q.id);
    const isWhoami = !!q.is_whoami;
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
      // For a Who/What Am I, options holds the clue objects [{text,points}]
      options: (!isWhoami && Array.isArray(q.options) && q.options.length) ? [...q.options] : ['', '', '', ''],
      is_whoami: isWhoami,
      clues: isWhoami && Array.isArray(q.options) && q.options.length
        ? q.options.map(c => ({ text: c?.text || '', points: c?.points ?? 1 }))
        : defaultClues()
    });
  };

  const newQuestion = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Who/What Am I sets save straight to the question bank (no MCQ / duplicate
    // import path). Clues go in `options` as [{text,points}].
    if (form.is_whoami) {
      const clues = form.clues
        .map(c => ({ text: String(c.text || '').trim(), points: Number(c.points) || 0 }))
        .filter(c => c.text);
      if (clues.length === 0) { setError('Add at least one clue.'); return; }
      const payload = {
        text: form.text.trim() || 'Who Am I?',
        answer: form.answer,
        type: 'text',
        points: clues[0]?.points ?? 1,
        category: form.category,
        difficulty: form.difficulty,
        answer_mode: 'text',
        question_format: 'standard',
        approved: form.approved,
        options: clues,
        is_whoami: true
      };
      try {
        if (editingId) await api.put(`/questions/${editingId}`, payload);
        else           await api.post('/questions', payload);
        await loadAll();
        newQuestion();
      } catch (err) {
        setError('Save failed: ' + err.message);
      }
      return;
    }

    const payload = {
      ...form,
      options: (form.answer_mode === 'mcq' || form.answer_mode === 'both') ? form.options.filter(o => o.trim()) : []
    };
    // Editing an existing question saves directly — no duplicate check needed.
    if (editingId) {
      try {
        await api.put(`/questions/${editingId}`, payload);
        await loadAll();
        newQuestion();
      } catch (err) {
        setError('Save failed: ' + err.message);
      }
      return;
    }
    // A brand-new question goes through the same duplicate-aware path as CSV import.
    startImport([payload]);
  };

  // Read the chosen CSV, parse it client-side, then run duplicate checking.
  const handleCSVUpload = async () => {
    if (!csvFile) return;
    try {
      const text = await csvFile.text();
      const parsed = csvToQuestions(text);
      if (parsed.length === 0) { setError('No questions found in that CSV.'); return; }
      setCsvOpen(false);
      setCsvFile(null);
      startImport(parsed);
    } catch (err) {
      setError('Could not read CSV: ' + err.message);
    }
  };

  // Split parsed questions into duplicates (already in the bank by text) and new
  // ones. New questions always pass through; duplicates open the resolution
  // modal. If there are no duplicates we import straight away.
  const startImport = (rawParsed) => {
    // Clean special characters in the stored text before matching/importing.
    const parsed = rawParsed.map(q => ({
      ...q,
      text: cleanText(q.text),
      answer: cleanText(q.answer),
      options: Array.isArray(q.options) ? q.options.map(cleanText) : q.options
    }));
    const existingByText = new Map(questions.map(q => [normText(q.text), q]));
    const dupes = [], fresh = [];
    parsed.forEach(q => {
      const match = existingByText.get(normText(q.text));
      if (match) dupes.push({ question: q, existingId: match.id, existingText: match.text });
      else fresh.push({ question: q });
    });
    setImportNew(fresh);
    setImportDupes(dupes);
    if (dupes.length > 0) {
      setResolveOpen(true);
    } else {
      doImport(fresh.map(f => ({ action: 'add', question: f.question })));
    }
  };

  // Send the resolved item list to the backend and show the success summary.
  const doImport = async (items) => {
    setImporting(true);
    try {
      const summary = await api.post('/questions/import', { items });
      await loadAll();
      newQuestion();
      setResolveOpen(false);
      setImportDupes([]);
      setImportNew([]);
      setSuccessSummary(summary);
    } catch (err) {
      setError('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  // Called by the resolve modal with a chosen action per duplicate. New
  // (non-duplicate) questions are appended automatically as plain adds.
  const confirmResolve = (resolvedDupes) => {
    const items = [
      ...importNew.map(f => ({ action: 'add', question: f.question })),
      ...resolvedDupes.map(d => ({ action: d.action, question: d.question, existingId: d.existingId }))
    ];
    doImport(items);
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

  // ── Who/What Am I clue helpers ──
  const updateClue = (i, patch) =>
    setForm(f => ({ ...f, clues: f.clues.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  const addClue = () =>
    setForm(f => ({ ...f, clues: [...f.clues, { text: '', points: 1 }] }));
  const removeClue = (i) =>
    setForm(f => f.clues.length <= 1 ? f : ({ ...f, clues: f.clues.filter((_, idx) => idx !== i) }));
  const autoCluePoints = () =>
    setForm(f => ({ ...f, clues: f.clues.map((c, i) => ({ ...c, points: f.clues.length - i })) }));
  const setKind = (whoami) =>
    setForm(f => ({
      ...f,
      is_whoami: whoami,
      text: whoami && !f.text ? 'Who Am I?' : f.text,
      clues: (whoami && (!f.clues || f.clues.length === 0)) ? defaultClues() : f.clues
    }));

  const showMcq = !form.is_whoami && (form.answer_mode === 'mcq' || form.answer_mode === 'both');

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
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="all">All media types</option>
                {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={filterAnswerMode} onChange={(e) => setFilterAnswerMode(e.target.value)}>
                <option value="all">All answer modes</option>
                {ANSWER_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
                <option value="all">All kinds</option>
                <option value="standard">Standard</option>
                <option value="whoami">Who / What Am I?</option>
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
                  <SourceBadge value={q.source || 'local'} />
                  {q.is_whoami ? (
                    <>
                      <span className="qm-tag qm-tag-whoami" title="Who / What Am I?">🕵 W/W Am I</span>
                      <span className="qm-tag qm-tag-cat">{Array.isArray(q.options) ? q.options.length : 0} clues</span>
                    </>
                  ) : (
                    <>
                      <DifficultyBadge value={q.difficulty || 'medium'} />
                      <span className={`qm-tag qm-tag-${q.answer_mode || 'text'}`}>{q.answer_mode || 'text'}</span>
                      {q.category && <span className="qm-tag qm-tag-cat">{q.category}</span>}
                      <span className="qm-points">{q.points} pt</span>
                    </>
                  )}
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
            <label className="form-label">Kind
              <select
                value={form.is_whoami ? 'whoami' : 'standard'}
                onChange={(e) => setKind(e.target.value === 'whoami')}
                disabled={!!editingId}
                title={editingId ? 'Kind is fixed when editing — create a new item to change it' : undefined}
              >
                <option value="standard">Standard question</option>
                <option value="whoami">Who / What Am I?</option>
              </select>
            </label>

            <label className="form-label">{form.is_whoami ? 'Title (e.g. “Who Am I?” / “What Am I?”)' : 'Question text'}
              <textarea
                placeholder={form.is_whoami ? 'Who Am I?' : "What's the capital of France?"}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                rows={form.is_whoami ? 1 : 3}
                required
              />
            </label>

            {!form.is_whoami && (
              <>
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
              </>
            )}

            <label className={`approved-toggle ${form.approved ? 'is-approved' : ''}`}>
              <input
                type="checkbox"
                checked={form.approved}
                onChange={(e) => setForm({ ...form, approved: e.target.checked })}
              />
              {form.approved ? '✓ Approved for use in quizzes' : 'Not yet approved — check to approve'}
            </label>

            {/* Standard question: MCQ options + single answer + media */}
            {!form.is_whoami && (
              <>
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
                  <div className="form-label">
                    {form.type === 'image' ? 'Image' : form.type === 'video' ? 'Video' : 'Audio'} file
                    {form.media_url ? (
                      <div className="qm-media-selected">
                        {form.type === 'image' ? (
                          <img className="qm-media-thumb" src={form.media_url} alt="" />
                        ) : (
                          <span className="qm-media-thumb qm-media-thumb-icon">
                            {form.type === 'video' ? '🎬' : '🎵'}
                          </span>
                        )}
                        <span className="qm-media-fname" title={form.media_url}>
                          {form.media_url.split('/').pop()}
                        </span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMediaPickerOpen(true)}>
                          Change
                        </button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => setForm({ ...form, media_url: '' })}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="qm-media-btn" onClick={() => setMediaPickerOpen(true)}>
                        📁 Select / upload {form.type}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Who / What Am I: reversed-MCQ layout — numbered clues then the answer */}
            {form.is_whoami && (
              <>
                <div className="whoami-q-editor">
                  <div className="whoami-q-head">
                    <label className="form-label" style={{ margin: 0 }}>Clues (one revealed before each round)</label>
                    <div className="whoami-q-head-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={autoCluePoints}>Auto points (high→1)</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={addClue}>+ Add clue</button>
                    </div>
                  </div>
                  <p className="help-text" style={{ marginTop: 0 }}>
                    Earlier clues are harder and worth more. Teams lock in one guess — the earlier they lock, the more points.
                  </p>
                  {form.clues.map((c, i) => (
                    <div key={i} className="whoami-q-row">
                      <span className="whoami-q-num">{i + 1}.</span>
                      <input
                        type="text"
                        className="whoami-q-text"
                        placeholder={`Clue ${i + 1}${i === form.clues.length - 1 ? ' (easiest)' : ''}`}
                        value={c.text}
                        onChange={(e) => updateClue(i, { text: e.target.value })}
                      />
                      <input
                        type="number"
                        className="whoami-q-points"
                        min="0"
                        step="0.5"
                        value={c.points}
                        onChange={(e) => updateClue(i, { points: e.target.value === '' ? '' : Number(e.target.value) })}
                        title="Points if a team locks in on this clue"
                      />
                      <button
                        type="button"
                        className="mcq-remove-btn"
                        onClick={() => removeClue(i)}
                        disabled={form.clues.length <= 1}
                        title={form.clues.length <= 1 ? 'Need at least one clue' : 'Remove clue'}
                      >×</button>
                    </div>
                  ))}
                </div>

                <label className="form-label">Answer (the shared solution, revealed at the end)
                  <input
                    type="text"
                    placeholder="e.g. Albert Einstein"
                    value={form.answer}
                    onChange={(e) => setForm({ ...form, answer: e.target.value })}
                    required
                  />
                </label>
              </>
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
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import Questions from CSV</h3>
              <button onClick={() => setCsvOpen(false)} className="btn-close">×</button>
            </div>
            <div className="modal-body">
              <p className="help-text">Columns: question, answer, type, points, media_url, category, difficulty, answer_mode, question_format, approved, options (pipe-separated). Column order is flexible.</p>
              <p className="help-text">New questions import automatically. Any that already exist (same question text) are flagged so you can overwrite, ignore, or keep a copy.</p>
              <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} />
              {csvFile && <p className="help-text">📁 {csvFile.name}</p>}
            </div>
            <div className="modal-footer">
              <button onClick={() => setCsvOpen(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={handleCSVUpload} className="btn btn-primary" disabled={!csvFile}>Check &amp; Import</button>
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

      {mediaPickerOpen && (
        <MediaPicker
          onPick={(f) => {
            setForm(prev => ({ ...prev, media_url: f.url, type: mimeToType(f.mime_type) }));
            setMediaPickerOpen(false);
          }}
          onClose={() => setMediaPickerOpen(false)}
        />
      )}

      {resolveOpen && (
        <ImportResolveModal
          dupes={importDupes}
          newCount={importNew.length}
          importing={importing}
          onConfirm={confirmResolve}
          onClose={() => { setResolveOpen(false); setImportDupes([]); setImportNew([]); }}
        />
      )}

      {successSummary && (
        <ImportSuccessModal summary={successSummary} onClose={() => setSuccessSummary(null)} />
      )}
    </div>
  );
}

// ── Duplicate-resolution modal ───────────────────────────────────────────────
// Lists every question that already exists, each with Overwrite / Ignore / Keep
// copy buttons (plus Apply-to-all shortcuts). New questions import automatically.
function ImportResolveModal({ dupes, newCount, importing, onConfirm, onClose }) {
  const [actions, setActions] = useState(() => dupes.map(() => 'ignore'));
  const setAction = (i, a) => setActions(prev => prev.map((x, idx) => (idx === i ? a : x)));
  const setAll = (a) => setActions(dupes.map(() => a));
  const confirm = () => onConfirm(dupes.map((d, i) => ({ ...d, action: actions[i] })));

  return (
    <div className="modal-overlay" onClick={importing ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Duplicate questions found</h3>
          <button onClick={onClose} className="btn-close" disabled={importing}>×</button>
        </div>
        <div className="modal-body">
          <p className="help-text">
            {newCount} new question{newCount !== 1 ? 's' : ''} will be added automatically.
            {' '}{dupes.length} already exist{dupes.length === 1 ? 's' : ''} — choose what to do with each.
          </p>

          <div className="import-bulk-actions">
            <span>Apply to all:</span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAll('overwrite')}>Overwrite</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAll('ignore')}>Ignore</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAll('copy')}>Keep copy</button>
          </div>

          <ul className="import-dupe-list">
            {dupes.map((d, i) => (
              <li key={i} className="import-dupe-row">
                <div className="import-dupe-text">
                  <span className="import-dupe-q">{d.question.text}</span>
                  <span className="import-dupe-meta">New answer: {d.question.answer || '—'}</span>
                </div>
                <div className="import-dupe-actions">
                  <button type="button" className={`idupe-btn ${actions[i] === 'overwrite' ? 'active-over' : ''}`}  onClick={() => setAction(i, 'overwrite')}>Overwrite</button>
                  <button type="button" className={`idupe-btn ${actions[i] === 'ignore' ? 'active-ignore' : ''}`}    onClick={() => setAction(i, 'ignore')}>Ignore</button>
                  <button type="button" className={`idupe-btn ${actions[i] === 'copy' ? 'active-copy' : ''}`}        onClick={() => setAction(i, 'copy')}>Keep copy</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary" disabled={importing}>Cancel</button>
          <button onClick={confirm} className="btn btn-primary" disabled={importing}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import success summary (same modal styling as the rest) ───────────────────
function ImportSuccessModal({ summary, onClose }) {
  const { added = [], copied = [], overwritten = [], ignored = 0 } = summary || {};
  const total = added.length + copied.length + overwritten.length;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>✓ Import complete</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body">
          <p className="help-text">
            {total} question{total !== 1 ? 's' : ''} saved{ignored ? `, ${ignored} ignored` : ''}.
          </p>
          {added.length > 0       && <ImportSummaryGroup label="Added"       items={added}       className="isum-added" />}
          {overwritten.length > 0 && <ImportSummaryGroup label="Overwritten" items={overwritten} className="isum-over" />}
          {copied.length > 0      && <ImportSummaryGroup label="Copied"      items={copied}      className="isum-copy" />}
          {total === 0 && ignored > 0 && <p className="help-text">No changes — all duplicates were ignored.</p>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-primary">Done</button>
        </div>
      </div>
    </div>
  );
}

function ImportSummaryGroup({ label, items, className }) {
  return (
    <div className="import-summary-group">
      <p className={`import-summary-label ${className}`}>{label} ({items.length})</p>
      <ul className="import-summary-list">
        {items.slice(0, 50).map((t, i) => <li key={i}>{t}</li>)}
        {items.length > 50 && <li>…and {items.length - 50} more</li>}
      </ul>
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

// Where the question came from: Local (added here), Repo (from a GitHub pack),
// or L&R (exists in both).
function SourceBadge({ value }) {
  const map = {
    local: { label: 'Local', cls: 'qm-src-local' },
    repo:  { label: 'Repo',  cls: 'qm-src-repo' },
    both:  { label: 'L&R',   cls: 'qm-src-both' }
  };
  const s = map[value] || map.local;
  return <span className={`qm-src ${s.cls}`} title={`Source: ${s.label}`}>{s.label}</span>;
}
