import { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api } from '../services/api';

const WIDGET_TYPES = [
  { value: 'scoreboard', label: 'Scoreboard' },
  { value: 'rules', label: 'Rules Slide' },
  { value: 'custom', label: 'Custom Page' }
];

export default function QuizBuilder() {
  const [quizzes, setQuizzes] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [name, setName] = useState('');
  const [order, setOrder] = useState([]); // [{ kind: 'round'|'widget', id, ... }]
  const [error, setError] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [qz, rs] = await Promise.all([api.get('/quizzes'), api.get('/rounds')]);
      setQuizzes(qz);
      setRounds(rs);
    } catch (err) {
      setError(err.message);
    }
  };

  const availableRounds = useMemo(() => {
    const usedIds = new Set(order.filter(i => i.kind === 'round').map(i => i.id));
    return rounds.filter(r => !usedIds.has(r.id));
  }, [rounds, order]);

  const addWidget = (type) => {
    setOrder([...order, { kind: 'widget', id: `widget-${Date.now()}`, type, data: {} }]);
  };

  const onDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    if (source.droppableId === 'palette-rounds' && destination.droppableId === 'quiz-order') {
      const id = parseInt(draggableId.replace('palette-round-', ''), 10);
      const round = rounds.find(r => r.id === id);
      if (round) {
        const next = [...order];
        next.splice(destination.index, 0, { kind: 'round', id: round.id, name: round.name });
        setOrder(next);
      }
      return;
    }

    if (source.droppableId === 'quiz-order' && destination.droppableId === 'quiz-order') {
      const next = [...order];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      setOrder(next);
      return;
    }

    if (source.droppableId === 'quiz-order' && destination.droppableId === 'palette-rounds') {
      const next = [...order];
      next.splice(source.index, 1);
      setOrder(next);
    }
  };

  const removeItem = (i) => {
    const next = [...order];
    next.splice(i, 1);
    setOrder(next);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const roundIds = order.filter(i => i.kind === 'round').map(i => i.id);
      const widgets = order.filter(i => i.kind === 'widget').map(i => ({ type: i.type, data: i.data || {} }));
      const newQuiz = await api.post('/quizzes', { name, rounds: roundIds, widgets });
      alert(`Quiz created! Code: ${newQuiz.code}`);
      setName('');
      setOrder([]);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="builder-page">
      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}

      <div className="builder-header">
        <h2>New Quiz</h2>
        <form onSubmit={handleCreate} className="builder-form-inline">
          <input
            type="text"
            placeholder="Quiz name (e.g. Tuesday Pub Quiz)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={!name || order.length === 0}>
            Create Quiz ({order.length} items)
          </button>
        </form>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="dnd-split">
          <div className="dnd-panel">
            <div className="dnd-panel-header">
              <h3>Available Rounds</h3>
              <p className="dnd-hint">Drag rounds to add. Add widgets below.</p>
            </div>

            <Droppable droppableId="palette-rounds">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="dnd-list">
                  {availableRounds.length === 0 ? (
                    <p className="dnd-empty">No rounds available. Create some in the Rounds tab.</p>
                  ) : availableRounds.map((r, i) => (
                    <Draggable key={r.id} draggableId={`palette-round-${r.id}`} index={i}>
                      {(prov, snapshot) => (
                        <div
                          ref={prov.innerRef}
                          {...prov.draggableProps}
                          {...prov.dragHandleProps}
                          className={`dnd-item ${snapshot.isDragging ? 'dragging' : ''}`}
                          style={{ borderLeft: `4px solid ${r.background_color || '#00f0ff'}`, ...prov.draggableProps.style }}
                        >
                          <div className="dnd-item-text">{r.name}</div>
                          <div className="dnd-item-meta">
                            <span className="qm-tag qm-tag-cat">{(r.questions || []).filter(q => q && q.id).length} Q</span>
                            <span className="qm-tag qm-tag-text">{r.format}</span>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>

            <div className="widget-adder">
              <h4>Add Widget</h4>
              <div className="widget-buttons">
                {WIDGET_TYPES.map(w => (
                  <button key={w.value} onClick={() => addWidget(w.value)} type="button" className="btn btn-secondary btn-sm">
                    + {w.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="dnd-panel">
            <div className="dnd-panel-header">
              <h3>Quiz Order ({order.length})</h3>
              <p className="dnd-hint">Drop here, reorder, drag back to remove</p>
            </div>

            <Droppable droppableId="quiz-order">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`dnd-list dnd-target ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                >
                  {order.length === 0 ? (
                    <p className="dnd-empty">Drop rounds and widgets here to build your quiz.</p>
                  ) : order.map((item, i) => (
                    <Draggable key={`${item.kind}-${item.id}-${i}`} draggableId={`order-${item.kind}-${item.id}-${i}`} index={i}>
                      {(prov, snapshot) => (
                        <div
                          ref={prov.innerRef}
                          {...prov.draggableProps}
                          {...prov.dragHandleProps}
                          className={`dnd-item dnd-item-selected ${snapshot.isDragging ? 'dragging' : ''}`}
                        >
                          <span className="dnd-order">{i + 1}</span>
                          <div className="dnd-item-text">
                            {item.kind === 'round' ? `🎯 ${item.name}` : `🧩 ${item.type} widget`}
                          </div>
                          <button onClick={() => removeItem(i)} className="btn-close" type="button">×</button>
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
        <h3>Existing Quizzes ({quizzes.length})</h3>
        <div className="quiz-list">
          {quizzes.map(q => (
            <div key={q.id} className="quiz-card">
              <h4>{q.name}</h4>
              <p>Code: <strong>{q.code}</strong></p>
              <p>Created: {new Date(q.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
