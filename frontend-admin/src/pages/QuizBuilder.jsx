import { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../services/api';

// ── Constants ────────────────────────────────────────────────────────────────
const WIDGET_TYPES = [
  { value: 'scoreboard', label: 'Scoreboard', icon: '🏆' },
  { value: 'rules',      label: 'Rules Slide', icon: '📋' },
  { value: 'custom',     label: 'Custom Page', icon: '🧩' }
];

const DEFAULT_WIDGET_DATA = {
  scoreboard: { title: 'Leaderboard', bg_color: '#0a0e1f' },
  rules:      { title: 'Rules', body: '1. No phones\n2. No shouting answers\n3. Have fun!', bg_color: '#0a0e1f' },
  custom:     { title: 'Custom Slide', body: '', image_url: '', bg_color: '#0a0e1f', bg_image: '' }
};


// ── Tile content (icon + label + meta) ──────────────────────────────────────
function TileBody({ item }) {
  if (item.kind === 'round') {
    const qc = item.questionCount ?? 0;
    return (
      <>
        <span className="so-icon">🎯</span>
        <span className="so-label" title={item.name}>{item.name}</span>
        <span className="so-meta">{qc} Q</span>
      </>
    );
  }
  const wt    = WIDGET_TYPES.find(w => w.value === item.type) || {};
  const label = item.data?.title || item.type;
  return (
    <>
      <span className="so-icon">{wt.icon || '🧩'}</span>
      <span className="so-label" title={label}>{label}</span>
      <span className="so-meta">{item.type}</span>
    </>
  );
}

// ── Sortable tile for new-quiz builder (has remove + edit buttons) ────────────
function BuilderTile({ item, index, onRemove, onEdit }) {
  const {
    attributes, listeners,
    setNodeRef, transform, transition, isDragging
  } = useSortable({ id: item.uid });

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1
  };

  return (
    <div ref={setNodeRef} style={style} className={`so-tile ${isDragging ? 'so-dragging' : ''}`}>
      <span className="so-grip" {...attributes} {...listeners}>⠿</span>
      <span className="so-num">{index + 1}</span>
      <TileBody item={item} />
      {item.kind === 'widget' && (
        <button type="button" className="so-btn" title="Edit widget" onClick={() => onEdit(item)}>✏</button>
      )}
      <button type="button" className="so-btn so-btn-rm" title="Remove" onClick={() => onRemove(item.uid)}>×</button>
    </div>
  );
}

// ── Read-only sortable tile for the quiz organizer panel ─────────────────────
function OrgTile({ item, index }) {
  const {
    attributes, listeners,
    setNodeRef, transform, transition, isDragging
  } = useSortable({ id: item.uid });

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1
  };

  return (
    <div ref={setNodeRef} style={style} className={`so-tile ${isDragging ? 'so-dragging' : ''}`}>
      <span className="so-grip" {...attributes} {...listeners}>⠿</span>
      <span className="so-num">{index + 1}</span>
      <TileBody item={item} />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function QuizBuilder() {
  const [quizzes, setQuizzes]       = useState([]);
  const [allRounds, setAllRounds]   = useState([]);
  const [name, setName]             = useState('');
  const [orderItems, setOrderItems] = useState([]);   // items in new-quiz order panel
  const [editingWidget, setEditingWidget] = useState(null);
  const [organizingId, setOrganizingId]   = useState(null);
  const [organizedData, setOrganizedData] = useState(null); // { id, name, rounds[], widgets[] }
  const [error, setError]           = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [qz, rs] = await Promise.all([api.get('/quizzes'), api.get('/rounds')]);
      setQuizzes(qz);
      setAllRounds(rs);
    } catch (err) { setError(err.message); }
  };

  // Rounds not yet in the order panel
  const availableRounds = useMemo(() => {
    const usedIds = new Set(orderItems.filter(i => i.kind === 'round').map(i => i.roundId));
    return allRounds.filter(r => !usedIds.has(r.id));
  }, [allRounds, orderItems]);

  // ── New quiz handlers ──────────────────────────────────────────────────────
  const addRound = (round) => {
    setOrderItems(prev => [...prev, {
      uid:           `r-${round.id}`,
      kind:          'round',
      roundId:       round.id,
      name:          round.name,
      questionCount: (round.questions || []).filter(q => q?.id).length
    }]);
  };

  const addWidget = (type) => {
    setOrderItems(prev => [...prev, {
      uid:  `w-${Date.now()}`,
      kind: 'widget',
      type,
      data: { ...DEFAULT_WIDGET_DATA[type] }
    }]);
  };

  const removeItem = (uid) => setOrderItems(prev => prev.filter(i => i.uid !== uid));

  const updateWidgetData = (uid, data) =>
    setOrderItems(prev => prev.map(i => i.uid === uid ? { ...i, data } : i));

  // @dnd-kit drag-end: same-container sort only
  const handleBuilderDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setOrderItems(items => {
      const from = items.findIndex(i => i.uid === active.id);
      const to   = items.findIndex(i => i.uid === over.id);
      return from < 0 || to < 0 ? items : arrayMove(items, from, to);
    });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const rounds  = orderItems.filter(i => i.kind === 'round').map(i => i.roundId);
      const widgets = orderItems.filter(i => i.kind === 'widget').map(i => ({ type: i.type, data: i.data || {} }));
      const newQuiz = await api.post('/quizzes', { name, rounds, widgets });
      alert(`Quiz created! Code: ${newQuiz.code}`);
      setName('');
      setOrderItems([]);
      loadAll();
    } catch (err) { setError(err.message); }
  };

  // ── Organizer for existing quiz ────────────────────────────────────────────
  const handleOrganize = async (quizId) => {
    if (organizingId === quizId) {
      setOrganizingId(null);
      setOrganizedData(null);
      return;
    }
    try {
      const quiz = await api.get(`/quizzes/${quizId}`);
      setOrganizingId(quizId);
      setOrganizedData({
        id:      quiz.id,
        name:    quiz.name,
        rounds:  (quiz.rounds  || []).map(r => ({
          uid:           `org-r-${r.id}`,
          kind:          'round',
          roundId:       r.id,
          name:          r.name,
          questionCount: (r.questions || []).filter(q => q?.id).length
        })),
        widgets: (quiz.widgets || []).map(w => ({
          uid:      `org-w-${w.id}`,
          kind:     'widget',
          widgetId: w.id,
          type:     w.type,
          data:     typeof w.data === 'string' ? JSON.parse(w.data) : (w.data || {})
        }))
      });
    } catch (err) { setError(err.message); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="builder-page">
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>
      )}

      {/* ── New Quiz ── */}
      <div className="panel">
        <div className="builder-header">
          <h2>New Quiz</h2>
          <form onSubmit={handleCreate} className="builder-form-inline">
            <input
              type="text"
              placeholder="Quiz name (e.g. Tuesday Pub Quiz)"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name || orderItems.length === 0}
            >
              Create Quiz ({orderItems.length} items)
            </button>
          </form>
        </div>

        <div className="dnd-split">
          {/* Left panel: round picker + widget buttons */}
          <div className="dnd-panel">
            <div className="dnd-panel-header">
              <h3>Available Rounds</h3>
              <p className="dnd-hint">Click a round to add it to your quiz</p>
            </div>

            <div className="so-round-picker">
              {availableRounds.length === 0 ? (
                <p className="dnd-empty">All rounds added.</p>
              ) : availableRounds.map(r => {
                const qc = (r.questions || []).filter(q => q?.id).length;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="so-round-chip"
                    style={{ borderLeft: `3px solid ${r.background_color || '#00f0ff'}` }}
                    onClick={() => addRound(r)}
                    title={`Add "${r.name}" to quiz`}
                  >
                    <span className="so-chip-name">{r.name}</span>
                    <span className="so-chip-meta">{qc} Q</span>
                    <span className="so-chip-add">+</span>
                  </button>
                );
              })}
            </div>

            <div className="widget-adder">
              <h4>Add Widget</h4>
              <div className="widget-buttons">
                {WIDGET_TYPES.map(w => (
                  <button
                    key={w.value}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => addWidget(w.value)}
                  >
                    {w.icon} {w.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right panel: sortable order list */}
          <div className="dnd-panel">
            <div className="dnd-panel-header">
              <h3>Quiz Order ({orderItems.length})</h3>
              <p className="dnd-hint">Drag tiles to reorder</p>
            </div>

            {orderItems.length === 0 ? (
              <p className="dnd-empty" style={{ padding: 24 }}>
                Click rounds on the left or add widgets to build your quiz.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleBuilderDragEnd}
              >
                <SortableContext
                  items={orderItems.map(i => i.uid)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="so-list">
                    {orderItems.map((item, i) => (
                      <BuilderTile
                        key={item.uid}
                        item={item}
                        index={i}
                        onRemove={removeItem}
                        onEdit={setEditingWidget}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      </div>

      {/* ── Existing Quizzes ── */}
      <div className="panel">
        <h3>Existing Quizzes ({quizzes.length})</h3>
        <div className="quiz-list">
          {quizzes.map(q => (
            <QuizCard
              key={q.id}
              quiz={q}
              isOpen={organizingId === q.id}
              orgData={organizingId === q.id ? organizedData : null}
              onOrganize={() => handleOrganize(q.id)}
              onOrgDataChange={setOrganizedData}
              onError={setError}
            />
          ))}
        </div>
      </div>

      {/* ── Widget editor modal ── */}
      {editingWidget && (
        <WidgetEditor
          widget={editingWidget}
          onSave={(data) => { updateWidgetData(editingWidget.uid, data); setEditingWidget(null); }}
          onClose={() => setEditingWidget(null)}
        />
      )}
    </div>
  );
}

// ── QuizCard with inline organizer ───────────────────────────────────────────
function QuizCard({ quiz, isOpen, orgData, onOrganize, onOrgDataChange, onError }) {
  const [saveState, setSaveState] = useState(null); // null | 'saving' | 'saved'

  const sensors = useSensors(
    useSensor(PointerSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Persist the current orgData to the backend
  const persist = async (nextData) => {
    setSaveState('saving');
    try {
      await api.put(`/quizzes/${quiz.id}/reorder`, {
        roundIds:  nextData.rounds.map(r => r.roundId),
        widgetIds: nextData.widgets.map(w => w.widgetId)
      });
      setSaveState('saved');
      setTimeout(() => setSaveState(null), 1800);
    } catch (err) {
      onError('Failed to save order: ' + err.message);
      setSaveState(null);
    }
  };

  // ── Reorder-persist code path ────────────────────────────────────────────
  // 1. @dnd-kit fires onDragEnd with { active, over }
  // 2. arrayMove() produces the new ordered array (optimistic UI update)
  // 3. onOrgDataChange() re-renders tiles immediately
  // 4. persist() → PUT /api/quizzes/:id/reorder → UPDATE quiz_rounds / quiz_widgets "order"
  const handleRoundDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id || !orgData) return;
    const rounds  = orgData.rounds;
    const from    = rounds.findIndex(r => r.uid === active.id);
    const to      = rounds.findIndex(r => r.uid === over.id);
    if (from < 0 || to < 0) return;
    const next = { ...orgData, rounds: arrayMove(rounds, from, to) };
    onOrgDataChange(next);
    persist(next);
  };

  const handleWidgetDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id || !orgData) return;
    const widgets = orgData.widgets;
    const from    = widgets.findIndex(w => w.uid === active.id);
    const to      = widgets.findIndex(w => w.uid === over.id);
    if (from < 0 || to < 0) return;
    const next = { ...orgData, widgets: arrayMove(widgets, from, to) };
    onOrgDataChange(next);
    persist(next);
  };

  return (
    <div className={`quiz-card ${isOpen ? 'quiz-card-open' : ''}`}>
      <div className="quiz-card-row">
        <div>
          <h4>{quiz.name}</h4>
          <p>Code: <strong>{quiz.code}</strong> · {new Date(quiz.created_at).toLocaleDateString()}</p>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${isOpen ? 'btn-primary' : 'btn-secondary'}`}
          onClick={onOrganize}
        >
          {isOpen ? '▲ Close' : '📋 Arrange'}
        </button>
      </div>

      {isOpen && orgData && (
        <div className="so-organizer">
          <div className="so-org-status">
            {saveState === 'saving' && <span className="so-saving">Saving…</span>}
            {saveState === 'saved'  && <span className="so-saved">✓ Saved</span>}
            {!saveState             && <span className="so-hint-drag">Drag tiles to change running order</span>}
          </div>

          <div className="so-org-cols">
            {/* Rounds */}
            <div className="so-org-section">
              <p className="so-section-hd">
                Rounds
                <span className="so-section-note">play in this order</span>
              </p>
              {orgData.rounds.length === 0 ? (
                <p className="so-empty">No rounds</p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleRoundDragEnd}
                >
                  <SortableContext
                    items={orgData.rounds.map(r => r.uid)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="so-list">
                      {orgData.rounds.map((r, i) => (
                        <OrgTile key={r.uid} item={r} index={i} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* Widgets */}
            <div className="so-org-section">
              <p className="so-section-hd">
                Widgets
                <span className="so-section-note">shown after all rounds</span>
              </p>
              {orgData.widgets.length === 0 ? (
                <p className="so-empty">No widgets</p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleWidgetDragEnd}
                >
                  <SortableContext
                    items={orgData.widgets.map(w => w.uid)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="so-list">
                      {orgData.widgets.map((w, i) => (
                        <OrgTile key={w.uid} item={w} index={i} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Widget editor modal ───────────────────────────────────────────────────────
function WidgetEditor({ widget, onSave, onClose }) {
  const [data, setData] = useState(widget.data || {});
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Widget: {widget.type}</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body">
          <label className="form-label">Title
            <input type="text" value={data.title || ''} onChange={e => set('title', e.target.value)} />
          </label>

          {(widget.type === 'rules' || widget.type === 'custom') && (
            <label className="form-label">Body text
              <textarea
                rows={6}
                placeholder="Line by line, supports multiple paragraphs"
                value={data.body || ''}
                onChange={e => set('body', e.target.value)}
              />
            </label>
          )}

          {widget.type === 'custom' && (
            <label className="form-label">Image URL (optional)
              <input
                type="text"
                placeholder="https://... or /uploads/..."
                value={data.image_url || ''}
                onChange={e => set('image_url', e.target.value)}
              />
            </label>
          )}

          <div className="form-row">
            <label className="form-label">Background color
              <input
                type="color"
                value={data.bg_color || '#0a0e1f'}
                onChange={e => set('bg_color', e.target.value)}
              />
            </label>
            <label className="form-label">Background image URL (optional)
              <input
                type="text"
                placeholder="https://..."
                value={data.bg_image || ''}
                onChange={e => set('bg_image', e.target.value)}
              />
            </label>
          </div>

          <WidgetPreview type={widget.type} data={data} />
        </div>
        <div className="modal-footer">
          <button onClick={onClose}      className="btn btn-secondary">Cancel</button>
          <button onClick={() => onSave(data)} className="btn btn-primary">Save Widget</button>
        </div>
      </div>
    </div>
  );
}

function WidgetPreview({ type, data }) {
  const style = {
    background: data.bg_image
      ? `url(${data.bg_image}) center/cover`
      : (data.bg_color || '#0a0e1f')
  };
  return (
    <div className="widget-preview" style={style}>
      <p className="widget-preview-label">Preview</p>
      {data.title    && <h3>{data.title}</h3>}
      {data.body     && <p style={{ whiteSpace: 'pre-line' }}>{data.body}</p>}
      {data.image_url && <img src={data.image_url} alt="" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8 }} />}
      {type === 'scoreboard' && <p className="widget-preview-hint">Live scoreboard appears here during the quiz</p>}
    </div>
  );
}
