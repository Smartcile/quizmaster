import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, sockets, controller } = setupBackend('../../backend/controllers/quizController.js');
const {
  getAllQuizzes, getActiveSession, resolveCode, createQuiz,
  setSessionStatus, setSessionSlide, restartSession, getSession,
  setScoreboardVisibility, reorderQuiz, deleteQuiz, updateQuiz,
  getSessionHistory, getSessionResults, getActiveTestSessions, deleteAllTestSessions, deleteSession,
} = controller;

let emit;
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
  emit = vi.fn();
  sockets.getIo.mockReset().mockReturnValue({ to: vi.fn(() => ({ emit })) });
});

// Minimal routing for loadQuizWithRoundsAndWidgets.
function loadQuizRoutes(sql) {
  if (/SELECT q\.\*, sm\.name/i.test(sql)) return { rows: [{ id: 1, name: 'Q', code: 'ABC123' }] };
  if (/FROM quiz_rounds qr/i.test(sql)) return { rows: [] };
  if (/FROM quiz_widgets/i.test(sql)) return { rows: [] };
  return { rows: [] };
}

describe('queries / active session', () => {
  it('getAllQuizzes returns rows', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = mockRes();
    await getAllQuizzes({}, res);
    expect(res.body).toEqual([{ id: 1 }]);
  });

  it('getActiveSession excludes test sessions and 404s when none', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await getActiveSession({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
    expect(db.query.mock.calls[0][0]).toMatch(/is_test = FALSE/);
  });

  it('getSession 404s when missing', async () => {
    const res = mockRes();
    await getSession({ params: { sessionId: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('resolveCode', () => {
  it('400s on an empty code', async () => {
    const res = mockRes();
    await resolveCode({ params: { code: '' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('prefers an exact session code', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/UPPER\(code\)/i.test(sql)) return { rows: [{ id: 9, quiz_id: 1 }] };
      return loadQuizRoutes(sql);
    });
    const res = mockRes();
    await resolveCode({ params: { code: 'ABC123' } }, res);
    expect(res.body.session).toEqual({ id: 9, quiz_id: 1 });
    expect(res.body.quiz).toMatchObject({ id: 1 });
  });

  it('falls back to the quiz code → live session (null when none running)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/UPPER\(code\)/i.test(sql)) return { rows: [] };
      if (/SELECT id FROM quizzes WHERE code/i.test(sql)) return { rows: [{ id: 1 }] };
      if (/FROM quiz_sessions/i.test(sql)) return { rows: [] };
      return loadQuizRoutes(sql);
    });
    const res = mockRes();
    await resolveCode({ params: { code: 'ABC123' } }, res);
    expect(res.body.session).toBeNull();
  });

  it('404s for an unknown code', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await resolveCode({ params: { code: 'ZZZZZZ' } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('createQuiz / updateQuiz', () => {
  it('creates a quiz and inserts interleaved items with positions', async () => {
    const client = mockClient((sql) => (/INSERT INTO quizzes/i.test(sql) ? { rows: [{ id: 1, code: 'ABC123' }] } : { rows: [] }));
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await createQuiz({
      body: { name: 'Q', items: [
        { kind: 'round', roundId: 5 },
        { kind: 'widget', type: 'scoreboard', data: { title: 'L' } },
      ] },
    }, res);
    const roundIns = client.query.mock.calls.find(c => /INSERT INTO quiz_rounds/i.test(c[0]));
    const widgetIns = client.query.mock.calls.find(c => /INSERT INTO quiz_widgets/i.test(c[0]));
    expect(roundIns[1]).toEqual([1, 5, 1, 0]);
    expect(widgetIns[1]).toEqual([1, 'scoreboard', JSON.stringify({ title: 'L' }), 1, 1]);
    expect(res.statusCode).toBe(201);
  });

  it('updateQuiz 404s when the quiz does not exist', async () => {
    db.getClient.mockResolvedValue(mockClient(() => ({ rows: [] })));
    const res = mockRes();
    await updateQuiz({ params: { id: 1 }, body: { name: 'x', items: [] } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('session lifecycle', () => {
  it('setSessionStatus rejects an invalid status', async () => {
    const res = mockRes();
    await setSessionStatus({ params: { sessionId: 1 }, body: { status: 'paused' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('setSessionStatus marks started_at when going active and broadcasts', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, status: 'active', current_slide_index: 2 }] });
    const res = mockRes();
    await setSessionStatus({ params: { sessionId: 1 }, body: { status: 'active' } }, res);
    expect(db.query.mock.calls[0][0]).toMatch(/started_at/);
    expect(emit).toHaveBeenCalledWith('session_status_changed', expect.objectContaining({ status: 'active' }));
  });

  it('setSessionSlide 400s on a non-number and broadcasts on success', async () => {
    expect((await setSessionSlide({ params: { sessionId: 1 }, body: { slideIndex: 'x' } }, mockRes())).statusCode).toBe(400);
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await setSessionSlide({ params: { sessionId: 1 }, body: { slideIndex: 3 } }, mockRes());
    expect(emit).toHaveBeenCalledWith('slide_changed', expect.objectContaining({ slideIndex: 3 }));
  });

  it('restartSession resets to the lobby', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, status: 'lobby' }] });
    const res = mockRes();
    await restartSession({ params: { sessionId: 1 } }, res);
    expect(db.query.mock.calls[0][0]).toMatch(/locked_round_ids = '\[\]'/);
    expect(emit).toHaveBeenCalledWith('session_status_changed', expect.objectContaining({ status: 'lobby' }));
  });
});

describe('setScoreboardVisibility', () => {
  it('404s when the session is missing', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await setScoreboardVisibility({ params: { sessionId: 1 }, body: { surface: 'slideshow', visible: true } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('toggles one surface and broadcasts the merged flags', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ scoreboard_visibility: { slideshow: true, quizzer: true, admin: false } }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = mockRes();
    await setScoreboardVisibility({ params: { sessionId: 1 }, body: { surface: 'slideshow', visible: false } }, res);
    expect(emit).toHaveBeenCalledWith('scoreboard_visibility_changed', expect.objectContaining({
      visibility: { slideshow: false, quizzer: true, admin: false },
    }));
  });

  it('400s on an invalid surface', async () => {
    db.query.mockResolvedValue({ rows: [{ scoreboard_visibility: {} }] });
    const res = mockRes();
    await setScoreboardVisibility({ params: { sessionId: 1 }, body: { surface: 'nope', visible: true } }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('reorderQuiz / deleteQuiz', () => {
  it('reorderQuiz updates positions for unified items', async () => {
    const client = mockClient();
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await reorderQuiz({ params: { id: 1 }, body: { items: [{ kind: 'round', roundId: 5 }, { kind: 'widget', widgetId: 9 }] } }, res);
    const pos = client.query.mock.calls.filter(c => /SET position = /i.test(c[0]));
    expect(pos).toHaveLength(2);
    expect(pos[0][1]).toEqual([0, 1, 5]);
    expect(res.body).toEqual({ ok: true });
  });

  it('deleteQuiz 409s while a live session exists', async () => {
    db.getClient.mockResolvedValue(mockClient((sql) => (/FROM quiz_sessions WHERE quiz_id/i.test(sql) ? { rows: [{ id: 3 }] } : { rows: [] })));
    const res = mockRes();
    await deleteQuiz({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
  });

  it('deleteQuiz removes a quiz with no live session', async () => {
    db.getClient.mockResolvedValue(mockClient((sql) => {
      if (/FROM quiz_sessions WHERE quiz_id/i.test(sql)) return { rows: [] };
      if (/DELETE FROM quizzes WHERE id/i.test(sql)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    }));
    const res = mockRes();
    await deleteQuiz({ params: { id: 1 } }, res);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('history / results / test sessions / deleteSession', () => {
  it('getSessionHistory returns finished sessions', async () => {
    db.query.mockResolvedValue({ rows: [{ session_id: 1 }] });
    const res = mockRes();
    await getSessionHistory({}, res);
    expect(db.query.mock.calls[0][0]).toMatch(/status = 'finished'/);
    expect(res.body).toEqual([{ session_id: 1 }]);
  });

  it('getSessionResults folds in the per-team Double Up ×2 and re-sorts', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/AS bonus/i.test(sql)) return { rows: [{ team_id: 1, bonus: 5 }] };
      if (/FROM double_up_choices/i.test(sql)) return { rows: [{ team_id: 1, round_id: 10 }] };
      if (/FROM teams t/i.test(sql)) return { rows: [
        { id: 1, name: 'A', size: 2, score_total: 5, brownie_total: 0, whoami_points: 0, size_points: 4 },
        { id: 2, name: 'B', size: 6, score_total: 12, brownie_total: 0, whoami_points: 0, size_points: 0 },
      ] };
      return { rows: [] };
    });
    const res = mockRes();
    await getSessionResults({ params: { sessionId: 1 } }, res);
    const a = res.body.teams.find(t => t.id === 1);
    expect(a.score_total).toBe(10);        // 5 raw + 5 double-up bonus
    // A total 10+4=14 > B total 12 → A leads
    expect(res.body.teams[0].id).toBe(1);
  });

  it('getActiveTestSessions / deleteAllTestSessions', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = mockRes();
    await getActiveTestSessions({}, res);
    expect(db.query.mock.calls[0][0]).toMatch(/is_test = TRUE/);

    db.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    const res2 = mockRes();
    await deleteAllTestSessions({}, res2);
    expect(res2.body).toEqual({ ok: true, deleted: 2 });
  });

  it('deleteSession: 404 unknown, 409 unfinished real, ok for finished', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    expect((await deleteSession({ params: { sessionId: 1 } }, mockRes())).statusCode).toBe(404);

    db.query.mockResolvedValueOnce({ rows: [{ status: 'active', is_test: false }] });
    expect((await deleteSession({ params: { sessionId: 1 } }, mockRes())).statusCode).toBe(409);

    db.query.mockResolvedValueOnce({ rows: [{ status: 'active', is_test: true }] });
    const res = mockRes();
    await deleteSession({ params: { sessionId: 1 } }, res);
    expect(res.body).toEqual({ ok: true });
  });
});
