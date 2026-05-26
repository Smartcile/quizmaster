import { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api } from '../services/api';

const EMPTY = { name: '', background_color: '#0a0e1f', format: 'standard' };

export default function RoundBuilder() {
  const [rounds, setRounds] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [form, setForm] = useState(EMPTY);
  const [selectedQuestions, setSelectedQuestions] = useState([]); // ordered ids
  const [editingId, setEditingId] = useState(null);
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
      setQuestions(qs);
      setCategories(cats);
    } catch (err) {
      setError(err.message);
    }
  };

  const filteredQuestions = useMemo(() => {
    return questions.filter(q => {
      if (selectedQuestions.includes(q.id)) return false;
      if (filterCategory !== 'all' && q.category !== filterCategory) return false;
      if (search) {
        const s = search.toLowerCase();
        return q.text.toLowerCase().includes(s);
      }
      return true;
    });
  }, [questions, search, filterCategory, selectedQuestions]);

  const selectedQuestionObjs = useMemo(() => {
    const byId = new Map(questions.map(q => [q.id, q]));
    return selectedQuestions.map(id => byId.get(id)).filter(Boolean);
  }, [selectedQuestions, questions]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, questions: selectedQuestions };
      if (editingId) await api.put(`/rounds/${editingId}`, payload);
      else await api.post('/rounds', payload);
      loadAll();
      reset();
    } catch (err) {
      setError(err.message);
    }
  };

  const editRound = (r) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      background_color: r.background_color || '#0a0e1f',
      format: r.format || 'standard'
    });
    const ids = (r.questions || []).filter(q => q && q.id).sort((a, b) => (a.order || 0) - (b.order || 0)).map(q => q.id);
    setSelectedQuestions(ids);
  };

  const reset = () => {
    setEditingId(null);
    setForm(EMPTY);
    setSelectedQuestions([]);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this round?')) return;
    try {
      await api.delete(`/rounds/${id}`);
      if (editingId === id) reset();
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const onDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    // From palette to selected
    if (source.droppableId === 'palette' && destination.droppableId === 'selected') {
      const id = parseInt(draggableId.replace('palette-', ''), 10);
      const next = [...selectedQuestions];
      next.splice(destination.index, 0, id);
      setSelectedQuestions(next);
      return;
    }

    // Reorder within selected
    if (source.droppableId === 'selected' && destination.droppableId === 'selected') {
      const next = [...selectedQuestions];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      setSelectedQuestions(next);
      return;
    }

    // Drag back to palette to remove
    if (source.droppableId === 'selected' && destination.droppableId === 'palette') {
      const next = [...selectedQuestions];
      next.splice(source.index, 1);
      setSelectedQuestions(next);
    }
  };

  return (
    <div className="builder-page">
      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

      <div className="builder-header">
        <h2>{editingId ? 'Edit Round' : 'New Round'}</h2>
        <form onSubmit={handleSubmit} className="builder-form-inline">
          <input
            type="text"
            placeholder="Round name (e.g. Geography)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
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
          <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Create'}</button>
          {editingId && <button type="button" onClick={reset} className="btn btn-secondary">Cancel</button>}
        </form>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="dnd-split">
          <div className="dnd-panel">
            <div className="dnd-panel-header">
              <h3>Available Questions</h3>
              <div className="dnd-filters">
                <input
                  type="search"
                  placeholder="🔍 Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                  <option value="all">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
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
                          <div className="dnd-item-text">{q.text}</div>
                          <div className="dnd-item-meta">
                            <span className={`qm-tag qm-tag-${q.type}`}>{q.type}</span>
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
        </div>
      </DragDropContext>

      <div className="panel">
        <h3>Existing Rounds ({rounds.length})</h3>
        <div className="round-list">
          {rounds.map(r => (
            <div key={r.id} className="round-item" style={{ borderLeftColor: r.background_color }}>
              <div>
                <h4>{r.name}</h4>
                <p>{(r.questions || []).filter(q => q && q.id).length} questions · {r.format}</p>
              </div>
              <div className="round-actions">
                <button onClick={() => editRound(r)} className="btn btn-sm">Edit</button>
                <button onClick={() => handleDelete(r.id)} className="btn btn-danger btn-sm">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
