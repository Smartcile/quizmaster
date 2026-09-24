import { describe, it, expect, beforeEach } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, sockets, controller } = setupBackend('../../backend/controllers/quizController.js');
const { startQuiz, loadQuizWithRoundsAndWidgets } = controller;

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
  sockets.getIo.mockReset().mockReturnValue(null);
});

// ── startQuiz: the "second session would wipe the lobby" guard ───────────────
function startClient({ quiz = { id: 5, name: 'Q' }, live = [] } = {}) {
  return mockClient((sql) => {
    if (/SELECT \* FROM quizzes WHERE id/i.test(sql)) return { rows: quiz ? [quiz] : [] };
    if (/FROM quiz_sessions s/i.test(sql) && /team_count/i.test(sql)) return { rows: live };
    if (/UPDATE quiz_sessions SET status = 'finished'/i.test(sql)) return { rows: [] };
    if (/INSERT INTO quiz_sessions/i.test(sql)) return { rows: [{ id: 77, quiz_id: 5, status: 'lobby', current_slide_index: 0 }] };
    return { rows: [] };
  });
}
const start = (client, body = {}) => {
  db.getClient.mockResolvedValue(client);
  const res = mockRes();
  return startQuiz({ params: { id: 5 }, body }, res).then(() => res);
};

describe('startQuiz', () => {
  it('500s when the quiz does not exist', async () => {
    const res = await start(startClient({ quiz: null }));
    expect(res.statusCode).toBe(500);
  });

  it('opens a fresh lobby session when none is running', async () => {
    const res = await start(startClient());
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 77, status: 'lobby' });
  });

  it('409s (and rolls back) when a live session exists and force is not set', async () => {
    const live = { id: 3, status: 'active', team_count: 6 };
    const client = startClient({ live: [live] });
    const res = await start(client);
    expect(res.statusCode).toBe(409);
    expect(res.body.liveSession).toEqual(live);
    expect(client.query.mock.calls.some(c => /^ROLLBACK/i.test(c[0]))).toBe(true);
  });

  it('proceeds when force:true', async () => {
    const res = await start(startClient({ live: [{ id: 3, status: 'active', team_count: 6 }] }), { force: true });
    expect(res.statusCode).toBe(201);
  });

  it('test sessions bypass the guard entirely', async () => {
    const res = await start(startClient({ live: [{ id: 3, status: 'lobby', team_count: 2 }] }), { isTest: true });
    expect(res.statusCode).toBe(201);
  });
});

// ── loadQuizWithRoundsAndWidgets ─────────────────────────────────────────────
function loadDb({ quiz = { id: 1, name: 'Q', code: 'ABC123' }, rounds = [], widgets = [], whoamiQ = null } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/SELECT q\.\*, sm\.name/i.test(sql)) return { rows: quiz ? [quiz] : [] };
    if (/FROM quiz_rounds qr/i.test(sql)) return { rows: rounds };
    if (/FROM quiz_widgets/i.test(sql)) return { rows: widgets };
    if (/FROM questions/i.test(sql)) return { rows: whoamiQ ? [whoamiQ] : [] };
    return { rows: [] };
  });
}

describe('loadQuizWithRoundsAndWidgets', () => {
  it('returns null for a missing quiz', async () => {
    loadDb({ quiz: null });
    expect(await loadQuizWithRoundsAndWidgets(1)).toBeNull();
  });

  it('interleaves rounds and widgets by shared position', async () => {
    loadDb({
      rounds: [
        { id: 10, position: 0, name: 'R1', questions: [{ id: 100 }] },
        { id: 20, position: 2, name: 'R2', questions: [] },
      ],
      widgets: [{ id: 100, type: 'scoreboard', position: 1, data: {} }],
    });
    const quiz = await loadQuizWithRoundsAndWidgets(1);
    expect(quiz.items.map(i => i.kind)).toEqual(['round', 'widget', 'round']);
    expect(quiz.items.map(i => i.id)).toEqual([10, 100, 20]);
    // Legacy arrays are still provided for older readers
    expect(quiz.rounds).toHaveLength(2);
    expect(quiz.widgets).toHaveLength(1);
  });

  it('falls back to rounds-then-widgets when every position is null', async () => {
    loadDb({
      rounds: [{ id: 10, position: null, name: 'R1', questions: [] }],
      widgets: [{ id: 100, type: 'rules', position: null, data: {} }],
    });
    const quiz = await loadQuizWithRoundsAndWidgets(1);
    expect(quiz.items.map(i => i.kind)).toEqual(['round', 'widget']);
  });

  it('hydrates a referenced Who Am I from its source question', async () => {
    loadDb({
      widgets: [{ id: 200, type: 'whoami', position: 0, data: { whoamiId: 42 } }],
      whoamiQ: { text: 'The Scientist', answer: 'Einstein', options: [{ text: 'c1', points: 5 }] },
    });
    const quiz = await loadQuizWithRoundsAndWidgets(1);
    const w = quiz.items.find(i => i.type === 'whoami');
    expect(w.data).toMatchObject({ whoamiId: 42, title: 'The Scientist', answer: 'Einstein' });
    expect(w.data.clues).toHaveLength(1);
    // The legacy widgets copy is hydrated too
    expect(quiz.widgets.find(x => x.type === 'whoami').data.answer).toBe('Einstein');
  });

  it('leaves an inline (legacy) Who Am I config untouched', async () => {
    loadDb({ widgets: [{ id: 200, type: 'whoami', position: 0, data: { answer: 'X', clues: [{ text: 'a', points: 1 }] } }] });
    const quiz = await loadQuizWithRoundsAndWidgets(1);
    expect(quiz.items.find(i => i.type === 'whoami').data).toMatchObject({ answer: 'X' });
  });
});
