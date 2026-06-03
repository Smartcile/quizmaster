import { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api } from '../services/api';

const EMPTY = { name: '', background_color: '#0a0e1f', format: 'standard' };

// Filter option lists — mirror the question editor so the round picker can be
// narrowed by every question attribute.
const DIFFICULTIES     = [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }];
const QUESTION_TYPES   = [{ value: 'text', label: 'Text' }, { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }];
const ANSWER_MODES     = [{ value: 'text', label: 'Text answer' }, { value: 'mcq', label: 'Multiple choice' }, { value: 'both', label: 'Both' }];
const QUESTION_FORMATS = [{ value: 'standard', label: 'Standard' }, { value: 'multichoice', label: 'Multichoice' }, { value: 'both', label: 'Both' }];

export default function RoundBuilder() {
  const [rounds, setRounds] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editInit, setEditInit] = useState(null); // initial state passed into the modal
  const [error, setError] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [rs, qs, cats] = await Promise.all([
        api.get('/rounds'),
        api.get('/questions'),
        api.get('/questions/categories')
      ]);
      setRounds(rs);
      // Who/What Am I sets are not normal questions — never offer them in rounds
      setQuestions((qs || []).filter(q => !q.is_whoami));
      setCategories(cats);
    } catch (err) {
      setError(err.message);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setEditInit({ form: EMPTY, selectedQuestions: [], formatOverrides: {} });
    setModalOpen(true);
  };

  const openEdit = (r) => {
    const sortedQs = (r.questions || [])
      .filter(q => q && q.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const overrides = {};
    sortedQs.forEach(q => {
      if (q.question_format_override) overrides[q.id] = q.question_format_override;
    });
    setEditingId(r.id);
    setEditInit({
      form: {
        name: r.name || '',
        background_color: r.background_color || '#0a0e1f',
        format: r.format || 'standard'
      },
      selectedQuestions: sortedQs.map(q => q.id),
      formatOverrides: overrides
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setEditInit(null);
  };

  const handleSave = async ({ form, selectedQuestions, formatOverrides }) => {
    try {
      const questionsPayload = selectedQuestions.map(id => ({
        id,
        question_format_override: formatOverrides[id] || null
      }));
      const payload = { ...form, questions: questionsPayload };
      if (editingId) await api.put(`/rounds/${editingId}`, payload);
      else await api.post('/rounds', payload);
      await loadAll();
      closeModal();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this round?')) return;
    try {
      await api.delete(`/rounds/${id}`);
      if (editingId === id) closeModal();
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="builder-page">
      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

      <div className="qm-toolbar">
        <h2>Rounds</h2>
        <div className="qm-toolbar-actions">
          <button className="btn btn-primary" onClick={openCreate}>+ Create Round</button>
        </div>
      </div>

      <div className="panel">
        <h3>Existing Rounds ({rounds.length})</h3>
        {rounds.length === 0 ? (
          <p className="dnd-empty">No rounds yet. Click “Create Round” to build your first one.</p>
        ) : (
          <div className="round-grid">
            {rounds.map(r => {
              const qCount = (r.questions || []).filter(q => q && q.id).length;
              return (
                <div
                  key={r.id}
                  className="round-card"
                  style={{ borderTopColor: r.background_color || 'var(--neon-cyan)' }}
                >
                  <div className="round-card-body" onClick={() => openEdit(r)}>
                    <h4 className="round-card-name">{r.name}</h4>
                    <div className="round-card-meta">
                      <span className="qm-tag qm-tag-cat">{r.format}</span>
                      <span className="qm-points">{qCount} Q</span>
                    </div>
                  </div>
                  <div className="round-card-actions">
                    <button onClick={() => openEdit(r)} className="btn btn-sm btn-secondary">✏ Edit</button>
                    <button onClick={() => handleDelete(r.id)} className="btn btn-sm btn-danger">🗑 Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen && editInit && (
        <RoundEditorModal
          editing={!!editingId}
          init={editInit}
          questions={questions}
          categories={categories}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

// ── Round create/edit modal (form + drag-drop question picker) ────────────────
function RoundEditorModal({ editing, init, questions, categories, onSave, onClose }) {
  const [form, setForm] = useState(init.form);
  const [selectedQuestions, setSelectedQuestions] = useState(init.selectedQuestions);
  const [formatOverrides, setFormatOverrides] = useState(init.formatOverrides);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory]     = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [filterType, setFilterType]             = useState('all');
  const [filterAnswerMode, setFilterAnswerMode] = useState('all');
  const [filterApproved, setFilterApproved]     = useState('all');

  // Same matching rules as the Questions page (search hits text OR answer) plus
  // a filter for every question attribute.
  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
      if (selectedQuestions.includes(q.id)) return false;
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
  }, [questions, search, filterCategory, filterDifficulty, filterType, filterAnswerMode, filterApproved, selectedQuestions]);

  const selectedQuestionObjs = useMemo(() => {
    const byId = new Map(questions.map(q => [q.id, q]));
    return selectedQuestions.map(id => byId.get(id)).filter(Boolean);
  }, [selectedQuestions, questions]);

  const toggleFormat = (questionId, value) => {
    setFormatOverrides(prev => ({ ...prev, [questionId]: value }));
  };

  // Whether a question can be shown as multiple-choice (has options).
  const hasOpt = (q) => Array.isArray(q.options) && q.options.filter(o => String(o).trim()).length > 0;
  // Effective per-round mode: explicit override, else derived from answer_mode.
  const effMode = (q) => {
    if (!hasOpt(q)) return 'standard';
    return formatOverrides[q.id] || (q.answer_mode === 'both' ? 'both' : 'multichoice');
  };

  const onDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    if (source.droppableId === 'palette' && destination.droppableId === 'selected') {
      const id = parseInt(draggableId.replace('palette-', ''), 10);
      const next = [...selectedQuestions];
      next.splice(destination.index, 0, id);
      setSelectedQuestions(next);
      return;
    }

    if (source.droppableId === 'selected' && destination.droppableId === 'selected') {
      const next = [...selectedQuestions];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      setSelectedQuestions(next);
      return;
    }

    if (source.droppableId === 'selected' && destination.droppableId === 'palette') {
      const next = [...selectedQuestions];
      next.splice(source.index, 1);
      setSelectedQuestions(next);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    onSave({ form, selectedQuestions, formatOverrides });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editing ? 'Edit Round' : 'New Round'}</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>

        <form onSubmit={submit} className="round-modal-form">
          <div className="modal-body round-modal-body">
            <div className="builder-form-inline">
              <input
                type="text"
                placeholder="Round name (e.g. Geography)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                autoFocus
              />
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                <option value="standard">Standard</option>
                <option value="rapid-fire">Rapid Fire</option>
                <option value="who-am-i">Who Am I?</option>
              </select>
              <input
                type="color"
                value={form.background_color}
                onChange={(e) => setForm({ ...form, background_color: e.target.value })}
                title="Background color"
              />
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
              <div className="dnd-split">
                <div className="dnd-panel">
                  <div className="dnd-panel-header">
                    <h3>Available Questions</h3>
                    <div className="dnd-filters">
                      <input
                        type="search"
                        placeholder="🔍 Search question or answer..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                        <option value="all">All categories</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="dnd-filters dnd-filters-extra">
                      <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)}>
                        <option value="all">All difficulties</option>
                        {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                      <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                        <option value="all">All media types</option>
                        {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <select value={filterAnswerMode} onChange={(e) => setFilterAnswerMode(e.target.value)}>
                        <option value="all">All answer modes</option>
                        {ANSWER_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <select value={filterApproved} onChange={(e) => setFilterApproved(e.target.value)}>
                        <option value="all">All statuses</option>
                        <option value="approved">Approved</option>
                        <option value="unapproved">Unapproved</option>
                      </select>
                    </div>
                  </div>

                  <Droppable droppableId="palette">
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="dnd-list">
                        {filteredQuestions.length === 0 ? (
                          <p className="dnd-empty">No questions match. Drag items here to remove.</p>
                        ) : filteredQuestions.map((q, i) => (
                          <Draggable key={q.id} draggableId={`palette-${q.id}`} index={i}>
                            {(prov, snapshot) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                className={`dnd-item ${snapshot.isDragging ? 'dragging' : ''}`}
                              >
                                <div className="dnd-item-text">{q.text}</div>
                                <div className="dnd-item-meta">
                                  <span className={`qm-tag qm-tag-${q.type}`}>{q.type}</span>
                                  {q.category && <span className="qm-tag qm-tag-cat">{q.category}</span>}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>

                <div className="dnd-panel">
                  <div className="dnd-panel-header">
                    <h3>Round Order ({selectedQuestions.length})</h3>
                    <p className="dnd-hint">Drag from left, reorder here, drag back to remove</p>
                  </div>

                  <Droppable droppableId="selected">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`dnd-list dnd-target ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                      >
                        {selectedQuestionObjs.length === 0 ? (
                          <p className="dnd-empty">Drop questions here to add them to the round.</p>
                        ) : selectedQuestionObjs.map((q, i) => (
                          <Draggable key={q.id} draggableId={`selected-${q.id}`} index={i}>
                            {(prov, snapshot) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                className={`dnd-item dnd-item-selected ${snapshot.isDragging ? 'dragging' : ''}`}
                              >
                                <span className="dnd-order">{i + 1}</span>
                                <div className="dnd-item-text">
                                  {q.text}
                                  {effMode(q) === 'both' && <span className="rq-both-label" title="Shown as text + multiple-choice">BOTH</span>}
                                </div>
                                {hasOpt(q) ? (
                                  <div className="rq-format-toggle" onClick={e => e.stopPropagation()} title="How this question is shown to teams in this round">
                                    <button type="button" className={`rq-toggle-btn ${effMode(q) === 'standard' ? 'active-std' : ''}`} onClick={() => toggleFormat(q.id, 'standard')}>Text</button>
                                    <button type="button" className={`rq-toggle-btn ${effMode(q) === 'multichoice' ? 'active-mcq' : ''}`} onClick={() => toggleFormat(q.id, 'multichoice')}>MCQ</button>
                                    <button type="button" className={`rq-toggle-btn ${effMode(q) === 'both' ? 'active-both' : ''}`} onClick={() => toggleFormat(q.id, 'both')}>Both</button>
                                  </div>
                                ) : (
                                  <span className="rq-format-badge rq-format-badge-standard">Text</span>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
            </DragDropContext>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!form.name}>
              {editing ? 'Update Round' : 'Create Round'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormatBadge({ value }) {
  const labels = { standard: 'STD', multichoice: 'MCQ', both: 'BOTH' };
  return <span className={`qm-tag qm-tag-fmt-${value || 'standard'}`}>{labels[value] || 'STD'}</span>;
}
