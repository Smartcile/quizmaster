import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupBackend, mockRes } from './helpers/backend.js';

const { db, sockets, controller } = setupBackend('../../backend/controllers/whoamiController.js');
const { loadWhoamiForSession, lockGuess, markGuess, getSessionWhoami } = controller;

let emit;
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  emit = vi.fn();
  sockets.getIo.mockReset().mockReturnValue({ to: vi.fn(() => ({ emit })) });
});

const WIDGET = {
  id: 1,
  data: { title: 'Who Am I?', answer: 'Einstein', clues: [{ text: 'c1', points: 5 }, { text: 'c2', points: 3 }] },
};

function whoamiDb({ widget = WIDGET, existing = [], upsertRow } = {}) {
  db.query.mockImplementation(async (sql, params) => {
    if (/quiz_widgets/i.test(sql)) return { rows: widget ? [widget] : [] };
    if (/FROM questions/i.test(sql)) return { rows: [] };
    if (/SELECT \* FROM whoami_guesses/i.test(sql)) return { rows: existing };
    if (/INSERT INTO whoami_guesses/i.test(sql)) {
      if (upsertRow) return { rows: [upsertRow] };
      return { rows: [{
        team_id: params[0], guess_text: params[1], locked_clue_index: params[2],
        points_possible: params[3], points_awarded: params[4], locked: params[5], auto_marked: true,
      }] };
    }
    if (/UPDATE whoami_guesses/i.test(sql)) return { rows: [] };
    if (/SELECT id FROM whoami_guesses/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

describe('loadWhoamiForSession', () => {
  it('returns null when the quiz has no Who Am I', async () => {
    whoamiDb({ widget: null });
    expect(await loadWhoamiForSession(1)).toBeNull();
  });

  it('hydrates { whoamiId } against the source question', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/quiz_widgets/i.test(sql)) return { rows: [{ id: 1, data: { whoamiId: 42 } }] };
      if (/FROM questions/i.test(sql)) return { rows: [{ text: 'The Scientist', answer: 'Einstein', options: [{ text: 'c1', points: 5 }] }] };
      return { rows: [] };
    });
    const cfg = await loadWhoamiForSession(1);
    expect(cfg).toMatchObject({ title: 'The Scientist', answer: 'Einstein' });
    expect(cfg.clues).toHaveLength(1);
  });

  it('parses JSON string data (legacy rows)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/quiz_widgets/i.test(sql)) return { rows: [{ id: 1, data: JSON.stringify({ answer: 'X', clues: [{ text: 'a', points: 1 }] }) }] };
      return { rows: [] };
    });
    expect(await loadWhoamiForSession(1)).toMatchObject({ answer: 'X' });
  });
});

describe('lockGuess', () => {
  it('404s when the quiz has no Who Am I', async () => {
    whoamiDb({ widget: null });
    const res = mockRes();
    await lockGuess({ body: { sessionId: 1, teamId: 1, clueIndex: 0, guess: 'x' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('400s without sessionId/teamId', async () => {
    const res = mockRes();
    await lockGuess({ body: { guess: 'x' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('awards the clue value and LOCKS on a correct guess', async () => {
    whoamiDb();
    const res = mockRes();
    await lockGuess({ body: { sessionId: 1, teamId: 2, clueIndex: 0, guess: '  the EINSTEIN ' } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ points_awarded: 5, correct: true, locked: true });
    expect(emit).toHaveBeenCalledWith('whoami_locked', expect.objectContaining({ teamId: 2, lockedClueIndex: 0 }));
    expect(emit).toHaveBeenCalledWith('whoami_marked', expect.objectContaining({ points: 5, autoMarked: true }));
  });

  it('scores 0 and does NOT lock on a wrong guess (retry allowed later)', async () => {
    whoamiDb();
    const res = mockRes();
    await lockGuess({ body: { sessionId: 1, teamId: 2, clueIndex: 0, guess: 'Newton' } }, res);
    expect(res.body).toMatchObject({ points_awarded: 0, correct: false, locked: false });
    expect(emit).not.toHaveBeenCalledWith('whoami_locked', expect.anything());
    expect(emit).toHaveBeenCalledWith('whoami_marked', expect.objectContaining({ points: 0 }));
  });

  it('is immutable once locked', async () => {
    whoamiDb({ existing: [{ id: 1, team_id: 2, locked: true, guess_text: 'Einstein', locked_clue_index: 0, points_possible: 5, points_awarded: 5 }] });
    const res = mockRes();
    await lockGuess({ body: { sessionId: 1, teamId: 2, clueIndex: 1, guess: 'x' } }, res);
    expect(res.body.alreadyLocked).toBe(true);
    expect(db.query.mock.calls.some(c => /INSERT INTO whoami_guesses/i.test(c[0]))).toBe(false);
  });

  it('409s on a repeat attempt at the same clue', async () => {
    whoamiDb({ existing: [{ id: 1, team_id: 2, locked: false, locked_clue_index: 0, guess_text: 'Newton' }] });
    const res = mockRes();
    await lockGuess({ body: { sessionId: 1, teamId: 2, clueIndex: 0, guess: 'again' } }, res);
    expect(res.statusCode).toBe(409);
  });

  it('clamps an out-of-range clue index to the last clue', async () => {
    whoamiDb();
    const res = mockRes();
    await lockGuess({ body: { sessionId: 1, teamId: 2, clueIndex: 99, guess: 'Einstein' } }, res);
    // clue[1] is worth 3, not clue[0]'s 5
    expect(res.body).toMatchObject({ points_awarded: 3, locked_clue_index: 1 });
  });
});

describe('markGuess', () => {
  it('400s without a teamId', async () => {
    const res = mockRes();
    await markGuess({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('upserts a manual override and broadcasts it', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM whoami_guesses/i.test(sql)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });
    const res = mockRes();
    await markGuess({ body: { sessionId: 1, teamId: 2, points: 3 } }, res);
    expect(res.body).toEqual({ ok: true, points: 3 });
    expect(emit).toHaveBeenCalledWith('whoami_marked', expect.objectContaining({ points: 3 }));
  });

  it('clears the mark when points is null', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM whoami_guesses/i.test(sql)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });
    const res = mockRes();
    await markGuess({ body: { sessionId: 1, teamId: 2, points: null } }, res);
    expect(res.body).toEqual({ ok: true, points: null });
  });
});

describe('getSessionWhoami', () => {
  it('returns null/[] when there is no Who Am I', async () => {
    whoamiDb({ widget: null });
    const res = mockRes();
    await getSessionWhoami({ params: { sessionId: 1 } }, res);
    expect(res.body).toEqual({ whoami: null, guesses: [] });
  });

  it('returns the config plus every team guess', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/quiz_widgets/i.test(sql)) return { rows: [WIDGET] };
      if (/FROM whoami_guesses/i.test(sql)) return { rows: [{ team_id: 2, points_awarded: 5 }] };
      return { rows: [] };
    });
    const res = mockRes();
    await getSessionWhoami({ params: { sessionId: 1 } }, res);
    expect(res.body.whoami.answer).toBe('Einstein');
    expect(res.body.guesses).toHaveLength(1);
  });
});
