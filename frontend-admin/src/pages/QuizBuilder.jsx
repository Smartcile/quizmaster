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
import DownloadFilesModal from '../components/DownloadFilesModal';
import MediaPicker from '../components/MediaPicker';

// ── Constants ────────────────────────────────────────────────────────────────
const WIDGET_TYPES = [
  { value: 'scoreboard', label: 'Scoreboard', icon: '🏆' },
  { value: 'rules',      label: 'Rules Slide', icon: '📋' },
  { value: 'custom',     label: 'Custom Page', icon: '🧩' },
  { value: 'review',     label: 'Answer Review', icon: '📝' }
];

const DEFAULT_WIDGET_DATA = {
  scoreboard: { title: 'Leaderboard', bg_color: '#0a0e1f' },
  rules:      { title: 'Rules', body: '1. No phones\n2. No shouting answers\n3. Have fun!', bg_color: '#0a0e1f' },
  custom:     { title: 'Custom Slide', body: '', image_url: '', bg_color: '#0a0e1f', bg_image: '' },
  // Answer Review: an end-of-quiz page where each team sees their own answers AND
  // the score awarded for each. Rendered specially on the quizzer.
  review:     { title: 'Your Answers & Scores', body: 'Review your answers and scores on your device.', bg_color: '#0a0e1f' }
};

// ── Tile content (icon + label + meta) ────────────────────────────────────────
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

// ── Sortable tile for new-quiz builder (has remove + edit buttons) ─────────────
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

// ── Helper: reconstruct UI items from quiz.items (API unified list) ───────────
// The Who/What Am I widget is NOT part of the running order — it's handled in
// its own bottom section — so it's filtered out here.
function quizItemsToUiItems(quizItems, prefix) {
  return (quizItems || []).filter(item => !(item.kind === 'widget' && item.type === 'whoami')).map(item => {
    if (item.kind === 'round') {
      return {
        uid:           `${prefix}-r-${item.id}`,
        kind:          'round',
        roundId:       item.id,
        name:          item.name,
        questionCount: (item.questions || []).filter(q => q?.id).length
      };
    } else {
      return {
        uid:      `${prefix}-w-${item.id}`,
        kind:     'widget',
        widgetId: item.id,   // DB id — needed for reorder persist
        type:     item.type,
        data:     typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {})
      };
    }
  });
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function QuizBuilder() {
  const [quizzes, setQuizzes]       = useState([]);
  const [allRounds, setAllRounds]   = useState([]);
  const [masters, setMasters]       = useState([]);
  const [selectedMasterId, setSelectedMasterId] = useState('');
  const [name, setName]             = useState('');
  const [teamSizeScoring, setTeamSizeScoring] = useState(false);
  const [orderItems, setOrderItems] = useState([]);   // mixed rounds + widgets in build order
  const [editingWidget, setEditingWidget] = useState(null);
  const [editingQuiz, setEditingQuiz]     = useState(null);
  const [error, setError]           = useState(null);
  // Who/What Am I — attached separately (not part of the running order).
  const [whoamiList, setWhoamiList] = useState([]);   // available Who/What Am I sets
  const [whoamiId, setWhoamiId]     = useState(null);  // attached set id, or null
  const [whoamiPickerOpen, setWhoamiPickerOpen] = useState(false);
  const [filesQuizId, setFilesQuizId] = useState(null);  // quiz whose Download Files modal is open

  const sensors = useSensors(
    useSensor(PointerSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => { loadAll(); }, []);

  // The Default Profile is the standard for every quiz — preselect it for a new
  // quiz once masters have loaded (rather than leaving a quiz with no master).
  useEffect(() => {
    if (!editingQuiz && !selectedMasterId && masters.length) {
      const def = masters.find(m => m.is_default);
      if (def) setSelectedMasterId(String(def.id));
    }
  }, [masters, editingQuiz, selectedMasterId]);

  const loadAll = async () => {
    try {
      const [qz, rs, ms, qs] = await Promise.all([
        api.get('/quizzes'), api.get('/rounds'), api.get('/masters'),
        api.get('/questions').catch(() => [])
      ]);
      setQuizzes(qz);
      setAllRounds(rs);
      setMasters(ms);
      setWhoamiList((qs || []).filter(q => q.is_whoami));
    } catch (err) { setError(err.message); }
  };

  // Custom pages from the selected master become additional widget options
  const masterCustomPages = useMemo(() => {
    if (!selectedMasterId) return [];
    const m = masters.find(m => String(m.id) === String(selectedMasterId));
    return Array.isArray(m?.templates?.custom) ? m.templates.custom : [];
  }, [selectedMasterId, masters]);

  // Rounds not yet in the order panel (each round can only appear once)
  const availableRounds = useMemo(() => {
    const usedIds = new Set(orderItems.filter(i => i.kind === 'round').map(i => i.roundId));
    return allRounds.filter(r => !usedIds.has(r.id));
  }, [allRounds, orderItems]);

  // Detect questions that appear more than once across the quiz — whether in
  // two different rounds OR twice within the same round. Each round only carries
  // a question count in orderItems, so we look up the full round (with its
  // questions) from allRounds by id. Per-round occurrence counts are tracked so
  // an intra-round repeat can be shown as e.g. "Round 1 ×2".
  const duplicateQuestions = useMemo(() => {
    const byId = new Map(allRounds.map(r => [r.id, r]));
    const occ = new Map(); // questionId -> { text, total, rounds: Map(name -> count) }
    orderItems
      .filter(i => i.kind === 'round')
      .forEach(item => {
        const round = byId.get(item.roundId);
        if (!round) return;
        (round.questions || []).filter(q => q?.id).forEach(q => {
          if (!occ.has(q.id)) occ.set(q.id, { text: q.text, total: 0, rounds: new Map() });
          const entry = occ.get(q.id);
          entry.total += 1;
          entry.rounds.set(round.name, (entry.rounds.get(round.name) || 0) + 1);
        });
      });
    return [...occ.values()]
      .filter(v => v.total > 1)
      .map(v => ({
        text: v.text,
        // "Round 1", "Round 1 ×2", etc. — count shown only when repeated in a round
        rounds: [...v.rounds.entries()].map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
      }));
  }, [orderItems, allRounds]);

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

  // Add a master's custom page as a 'custom' widget pre-filled with its data
  const addMasterCustomPage = (page) => {
    setOrderItems(prev => [...prev, {
      uid:  `w-${Date.now()}`,
      kind: 'widget',
      type: 'custom',
      data: {
        title:     page.title    || '',
        body:      page.body     || '',
        image_url: page.imageUrl || '',
        bg_color:  page.bgColor  || '#0a0e1f',
      },
    }]);
  };

  const removeItem = (uid) => setOrderItems(prev => prev.filter(i => i.uid !== uid));

  const updateWidgetData = (uid, data) =>
    setOrderItems(prev => prev.map(i => i.uid === uid ? { ...i, data } : i));

  // @dnd-kit drag-end: reorder within the order panel
  const handleBuilderDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setOrderItems(items => {
      const from = items.findIndex(i => i.uid === active.id);
      const to   = items.findIndex(i => i.uid === over.id);
      return from < 0 || to < 0 ? items : arrayMove(items, from, to);
    });
  };

  // ── Create or update quiz ──────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    // Guard: never save a quiz that has the same question in more than one round
    // (also covers an Enter-key submit while the button is disabled).
    if (duplicateQuestions.length > 0) {
      setError('Resolve duplicate questions before saving — the same question appears in more than one round.');
      return;
    }
    try {
      // Running order = rounds + non-whoami widgets, in their drag order.
      const items = orderItems.map(i =>
        i.kind === 'round'
          ? { kind: 'round', roundId: i.roundId }
          : { kind: 'widget', type: i.type, data: i.data || {} }
      );
      // The Who/What Am I is attached separately (displayed throughout the quiz),
      // stored as a widget that only references the authored set by id.
      if (whoamiId) {
        items.push({ kind: 'widget', type: 'whoami', data: { whoamiId } });
      }
      const master_id = selectedMasterId ? parseInt(selectedMasterId) : null;

      if (editingQuiz) {
        await api.put(`/quizzes/${editingQuiz.id}`, { name, items, master_id, team_size_scoring: teamSizeScoring });
        setEditingQuiz(null);
      } else {
        const newQuiz = await api.post('/quizzes', { name, items, master_id, team_size_scoring: teamSizeScoring });
        alert(`Quiz created! Code: ${newQuiz.code}`);
      }
      setName('');
      setOrderItems([]);
      setSelectedMasterId('');
      setTeamSizeScoring(false);
      setWhoamiId(null);
      loadAll();
    } catch (err) { setError(err.message); }
  };

  const cancelEdit = () => {
    setEditingQuiz(null);
    setName('');
    setOrderItems([]);
    setSelectedMasterId('');
    setTeamSizeScoring(false);
    setWhoamiId(null);
  };

  // ── Load existing quiz into the builder form ───────────────────────────────
  const handleEdit = async (quizId) => {
    try {
      const quiz = await api.get(`/quizzes/${quizId}`);
      // quiz.items is the unified ordered sequence from the API
      const source = quiz.items || [
        ...(quiz.rounds  || []).map(r => ({ kind: 'round',  ...r })),
        ...(quiz.widgets || []).map(w => ({ kind: 'widget', ...w }))
      ];
      setEditingQuiz({ id: quiz.id });
      setName(quiz.name);
      // Quizzes with no stored master fall back to the Default Profile.
      const def = masters.find(m => m.is_default);
      setSelectedMasterId(quiz.master_id ? String(quiz.master_id) : (def ? String(def.id) : ''));
      setTeamSizeScoring(quiz.team_size_scoring || false);
      setOrderItems(quizItemsToUiItems(source, 'edit'));
      // Pull the attached Who/What Am I (if any) out of the running order
      const wItem = source.find(i => i.kind === 'widget' && i.type === 'whoami');
      let wData = wItem?.data;
      if (typeof wData === 'string') { try { wData = JSON.parse(wData); } catch { wData = {}; } }
      setWhoamiId(wData?.whoamiId ?? null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError(err.message); }
  };

  // ── Delete a quiz ─────────────────────────────────────────────────────────
  const handleDelete = async (quizId, quizName) => {
    if (!confirm(`Delete "${quizName}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/quizzes/${quizId}`);
      if (editingQuiz?.id === quizId) cancelEdit();
      loadAll();
    } catch (err) { setError(err.message); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="builder-page">
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>
      )}

      {/* ── New Quiz / Edit Quiz ── */}
      <div className={`panel ${editingQuiz ? 'panel-editing' : ''}`}>
        <div className="builder-header">
          <h2>{editingQuiz ? '✏ Edit Quiz' : 'New Quiz'}</h2>
          <form onSubmit={handleSubmit} className="builder-form-inline">
            <input
              type="text"
              placeholder="Quiz name (e.g. Tuesday Pub Quiz)"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
            <select
              className="builder-master-sel"
              value={selectedMasterId}
              onChange={e => setSelectedMasterId(e.target.value)}
              title="Master theme — every quiz uses one (defaults to the Default Profile)"
            >
              {masters.map(m => <option key={m.id} value={m.id}>{m.name}{m.is_default ? ' (Default)' : ''}</option>)}
            </select>
            <label className="quiz-tss-toggle">
              <input
                type="checkbox"
                checked={teamSizeScoring}
                onChange={e => setTeamSizeScoring(e.target.checked)}
              />
              Team size handicap
            </label>
            {editingQuiz && (
              <button type="button" className="btn btn-secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name || orderItems.length === 0 || duplicateQuestions.length > 0}
              title={duplicateQuestions.length > 0 ? 'Resolve duplicate questions before saving' : undefined}
            >
              {editingQuiz ? `Save Changes (${orderItems.length} items)` : `Create Quiz (${orderItems.length} items)`}
            </button>
          </form>
        </div>

        {duplicateQuestions.length > 0 && (
          <div className="quiz-dup-warning">
            <span className="quiz-dup-warning-title">
              ⚠ {duplicateQuestions.length} duplicate question{duplicateQuestions.length !== 1 ? 's' : ''} — resolve before saving:
            </span>
            <ul className="quiz-dup-list">
              {duplicateQuestions.map((d, i) => (
                <li key={i}>
                  <span className="quiz-dup-q">{d.text}</span>
                  <span className="quiz-dup-rounds">{d.rounds.join(' · ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="dnd-split">
          {/* Left panel: round picker + widget buttons */}
          <div className="dnd-panel">
            <div className="dnd-panel-header">
              <h3>Available Rounds</h3>
              <p className="dnd-hint">Click to add — rounds and widgets can be freely mixed</p>
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
              {masterCustomPages.length > 0 && (
                <div className="master-custom-pages">
                  <p className="master-custom-label">From master theme:</p>
                  <div className="widget-buttons">
                    {masterCustomPages.map(page => (
                      <button
                        key={page.id}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => addMasterCustomPage(page)}
                        title={page.body || page.title}
                      >
                        🧩 {page.name || page.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right panel: sortable order list — rounds and widgets freely mixed */}
          <div className="dnd-panel">
            <div className="dnd-panel-header">
              <h3>Quiz Order ({orderItems.length})</h3>
              <p className="dnd-hint">Drag tiles to reorder — mix rounds and widgets freely</p>
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

        {/* ── Who / What Am I? — attached separately; shown throughout the quiz ── */}
        <div className="whoami-attach">
          <div className="whoami-attach-head">
            <h3>🕵 Who / What Am I?</h3>
            <span className="dnd-hint">Shown throughout the quiz (a clue before each round). Content is edited in the Question Builder.</span>
          </div>
          {(() => {
            const sel = whoamiList.find(w => w.id === whoamiId);
            return (
              <div className="whoami-attach-body">
                {sel ? (
                  <div className="whoami-attach-current">
                    <span className="whoami-attach-icon">🕵</span>
                    <div className="whoami-attach-info">
                      <span className="whoami-attach-name">{sel.text || 'Who Am I?'}</span>
                      <span className="whoami-attach-meta">
                        {Array.isArray(sel.options) ? sel.options.length : 0} clues · answer: {sel.answer || '—'}
                      </span>
                    </div>
                    <button type="button" className="so-btn" title="Change selection" onClick={() => setWhoamiPickerOpen(true)}>⚙</button>
                    <button type="button" className="so-btn so-btn-rm" title="Detach" onClick={() => setWhoamiId(null)}>×</button>
                  </div>
                ) : whoamiId ? (
                  <div className="whoami-attach-current whoami-attach-missing">
                    <span className="whoami-attach-icon">⚠</span>
                    <div className="whoami-attach-info">
                      <span className="whoami-attach-name">Attached set not found</span>
                      <span className="whoami-attach-meta">It may have been deleted in the Question Builder.</span>
                    </div>
                    <button type="button" className="so-btn" title="Change selection" onClick={() => setWhoamiPickerOpen(true)}>⚙</button>
                    <button type="button" className="so-btn so-btn-rm" title="Detach" onClick={() => setWhoamiId(null)}>×</button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWhoamiPickerOpen(true)}>
                    ⚙ Attach a Who / What Am I?
                  </button>
                )}
              </div>
            );
          })()}
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
              isEditing={editingQuiz?.id === q.id}
              onEdit={() => handleEdit(q.id)}
              onDelete={() => handleDelete(q.id, q.name)}
              onFiles={() => setFilesQuizId(q.id)}
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

      {/* ── Who / What Am I? picker ── */}
      {whoamiPickerOpen && (
        <WhoamiPicker
          list={whoamiList}
          selectedId={whoamiId}
          onPick={(id) => { setWhoamiId(id); setWhoamiPickerOpen(false); }}
          onClose={() => setWhoamiPickerOpen(false)}
        />
      )}

      {/* ── Download Quiz Files ── */}
      {filesQuizId && (
        <DownloadFilesModal quizId={filesQuizId} onClose={() => setFilesQuizId(null)} />
      )}
    </div>
  );
}

// ── Who / What Am I? picker modal ─────────────────────────────────────────────
// Lists the Who/What Am I sets authored in the Question Builder. Read-only —
// content is edited there, not here.
function WhoamiPicker({ list, selectedId, onPick, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Select a Who / What Am I?</h3>
          <button onClick={onClose} className="btn-close">×</button>
        </div>
        <div className="modal-body">
          {list.length === 0 ? (
            <p className="help-text">
              No Who/What Am I sets yet. Create one in the <strong>Questions</strong> page
              (set Kind → “Who / What Am I?”).
            </p>
          ) : (
            <ul className="whoami-pick-list">
              {list.map(w => (
                <li key={w.id}>
                  <button
                    type="button"
                    className={`whoami-pick-item ${w.id === selectedId ? 'selected' : ''}`}
                    onClick={() => onPick(w.id)}
                  >
                    <span className="whoami-pick-name">{w.text || 'Who Am I?'}</span>
                    <span className="whoami-pick-meta">
                      {Array.isArray(w.options) ? w.options.length : 0} clues · {w.answer || '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── QuizCard ──────────────────────────────────────────────────────────────────
function QuizCard({ quiz, isEditing, onEdit, onDelete, onFiles }) {
  return (
    <div className={`quiz-card ${isEditing ? 'quiz-card-editing' : ''}`}>
      <div className="quiz-card-info" onClick={onEdit}>
        <h4>{quiz.name}</h4>
        <p>Code: <strong>{quiz.code}</strong> · {new Date(quiz.created_at).toLocaleDateString()}</p>
      </div>
      <div className="quiz-card-actions">
        <button
          type="button"
          className={`btn btn-sm ${isEditing ? 'btn-primary' : 'btn-secondary'}`}
          onClick={onEdit}
          title="Edit this quiz"
        >
          {isEditing ? '✏ Editing…' : '✏ Edit'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={onFiles}
          title="Download offline quiz files (PDFs + slideshow)"
        >
          ⬇ Files
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={onDelete}
          title="Delete this quiz"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// ── Widget editor modal ────────────────────────────────────────────────────────
function WidgetEditor({ widget, onSave, onClose }) {
  const [data, setData] = useState(widget.data || {});
  const [mediaOpen, setMediaOpen] = useState(false);
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
            <label className="form-label">Image (optional)
              <div className="qm-media-row">
                <input
                  type="text"
                  placeholder="https://... or /uploads/..."
                  value={data.image_url || ''}
                  onChange={e => set('image_url', e.target.value)}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMediaOpen(true)}>📁 Select</button>
              </div>
            </label>
          )}

          {widget.type === 'review' && (
            <label className="quiz-tss-toggle" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={!!data.showOnScoreboard}
                onChange={e => set('showOnScoreboard', e.target.checked)}
              />
              Show a "View my answers" button on the live scoreboard
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
          <button onClick={onClose}           className="btn btn-secondary">Cancel</button>
          <button onClick={() => onSave(data)} className="btn btn-primary">Save Widget</button>
        </div>
      </div>
      {mediaOpen && (
        <MediaPicker
          onPick={(f) => { set('image_url', f.url); setMediaOpen(false); }}
          onClose={() => setMediaOpen(false)}
        />
      )}
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
