import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupBackend, mockRes } from './helpers/backend.js';

const { db, sockets, controller } = setupBackend('../../backend/controllers/teamController.js');
const { joinQuiz, getSessionScoreboard } = controller;

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  sockets.getIo.mockReset().mockReturnValue(null);
});

// ── joinQuiz: find-or-create + foolproof rejoin ──────────────────────────────
function joinDb({ status = 'lobby', teams = [] } = {}) {
  db.query.mockImplementation(async (sql, params) => {
    if (/SELECT status FROM quiz_sessions/i.test(sql)) return { rows: status ? [{ status }] : [] };
    if (/SELECT \* FROM teams WHERE quiz_session_id/i.test(sql)) return { rows: teams };
    if (/UPDATE teams SET/i.test(sql)) {
      const id = params[params.length - 1];
      const row = { ...(teams.find(t => t.id === id) || { id }), id };
      let pi = 0;
      if (/device_id = \$\d/.test(sql)) row.device_id = params[pi++];
      if (/size = \$\d/.test(sql)) row.size = params[pi++];
      return { rows: [row] };
    }
    if (/INSERT INTO teams/i.test(sql)) return { rows: [{ id: 99, name: params[1], size: params[2], device_id: params[3] }] };
    return { rows: [] };
  });
}
const join = (body) => {
  const res = mockRes();
  return joinQuiz({ body }, res).then(() => res);
};

describe('joinQuiz', () => {
  it('400s without a name and 404s for an unknown session', async () => {
    expect((await join({ sessionId: 1, name: '  ' })).statusCode).toBe(400);
    joinDb({ status: null });
    expect((await join({ sessionId: 1, name: 'A' })).statusCode).toBe(404);
  });

  it('creates a new team when nothing matches', async () => {
    joinDb({ teams: [] });
    const res = await join({ sessionId: 1, name: 'New Team', size: 4, deviceId: 'd1' });
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('New Team');
  });

  it('rejoins on a punctuation/case-insensitive name match', async () => {
    joinDb({ teams: [{ id: 1, name: 'The-Quiz Kings!', size: 6, device_id: null }] });
    const res = await join({ sessionId: 1, name: 'the quiz kings', size: 4, deviceId: 'dev1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.rejoined).toBe(true);
    expect(res.body.id).toBe(1);
    const upd = db.query.mock.calls.find(c => /UPDATE teams SET/i.test(c[0]));
    expect(upd[1]).toEqual(['dev1', 4, 1]);   // device adopted, size updated
  });

  it('returns the existing team read-only in a finished session (no mutation)', async () => {
    joinDb({ status: 'finished', teams: [{ id: 1, name: 'Team', size: 6, device_id: null }] });
    const res = await join({ sessionId: 1, name: 'Team', size: 2, deviceId: 'dev9' });
    expect(res.statusCode).toBe(200);
    expect(res.body.finished).toBe(true);
    expect(res.body.id).toBe(1);
    // A finished session is read-only — nothing is updated (no device, no size)
    expect(db.query.mock.calls.some(c => /UPDATE teams SET/i.test(c[0]))).toBe(false);
  });

  it('404s in a finished session when no team matches (no ghost teams)', async () => {
    joinDb({ status: 'finished', teams: [{ id: 1, name: 'Team' }] });
    expect((await join({ sessionId: 1, name: 'Different' })).statusCode).toBe(404);
  });

  it('asks for confirmation on a close-but-not-exact name', async () => {
    joinDb({ teams: [{ id: 1, name: 'Quiz Kings' }] });
    const res = await join({ sessionId: 1, name: 'Quiz King' });
    expect(res.body.needsConfirm).toBe(true);
    expect(res.body.suggestion).toEqual({ id: 1, name: 'Quiz Kings' });
  });

  it('asks for confirmation when this device already has a team', async () => {
    joinDb({ teams: [{ id: 1, name: 'Other Team', device_id: 'devX' }] });
    const res = await join({ sessionId: 1, name: 'Brand New', deviceId: 'devX' });
    expect(res.body.needsConfirm).toBe(true);
    expect(res.body.suggestion.id).toBe(1);
  });

  it('forceNew skips the confirmation and creates a team', async () => {
    joinDb({ teams: [{ id: 1, name: 'Quiz Kings' }] });
    const res = await join({ sessionId: 1, name: 'Quiz King', forceNew: true });
    expect(res.statusCode).toBe(201);
  });

  it('confirmTeamId attaches this device to the chosen existing team', async () => {
    joinDb({ teams: [{ id: 5, name: 'Existing', size: 3, device_id: null }] });
    const res = await join({ sessionId: 1, name: 'whatever', confirmTeamId: 5, deviceId: 'dev5' });
    expect(res.statusCode).toBe(200);
    expect(res.body.rejoined).toBe(true);
    expect(res.body.id).toBe(5);
  });

  it('404s when the confirmed team is not in the session', async () => {
    joinDb({ teams: [{ id: 5, name: 'Existing' }] });
    expect((await join({ sessionId: 1, name: 'x', confirmTeamId: 77 })).statusCode).toBe(404);
  });
});

// ── getSessionScoreboard: per-round aggregation + Double Up + handicap ───────
describe('getSessionScoreboard', () => {
  function scoreboardDb({ teamSizeScoring = true, doubleChoices = [] } = {}) {
    return db.query.mockImplementation(async (sql) => {
      if (/FROM double_up_choices/i.test(sql)) return { rows: doubleChoices };
      if (/team_size_scoring/i.test(sql)) return { rows: [{ quiz_id: 1, team_size_scoring: teamSizeScoring }] };
      if (/FROM quiz_widgets/i.test(sql)) return { rows: [{ '?column?': 1 }] };
      if (/FROM whoami_guesses/i.test(sql)) return { rows: [{ team_id: 1, pts: 2 }] };
      if (/AS size_points/i.test(sql)) {
        return { rows: [
          { id: 1, name: 'Alpha', size: 2, size_points: 4, brownie_total: 0 },
          { id: 2, name: 'Beta', size: 10, size_points: -4, brownie_total: 3 },
        ] };
      }
      if (/AS team_id, qr\.round_id/i.test(sql)) {
        return { rows: [
          { team_id: 1, round_id: 10, pts: 5 },
          { team_id: 1, round_id: 20, pts: 2 },
          { team_id: 2, round_id: 10, pts: 1 },
        ] };
      }
      if (/FROM quiz_rounds qr/i.test(sql)) {
        return { rows: [{ id: 10, name: 'R1', format: 'standard' }, { id: 20, name: 'R2', format: 'standard' }] };
      }
      return { rows: [] };
    });
  }

  it('404s for an unknown session', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await getSessionScoreboard({ params: { sessionId: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('aggregates rounds + handicap + whoami and applies the Double Up ×2', async () => {
    scoreboardDb({ doubleChoices: [{ team_id: 1, round_id: 10 }] });
    const res = mockRes();
    await getSessionScoreboard({ params: { sessionId: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.teamSizeScoring).toBe(true);
    expect(res.body.hasBrownie).toBe(true);
    expect(res.body.hasWhoami).toBe(true);

    const alpha = res.body.teams.find(t => t.id === 1);
    expect(alpha.round_scores[10]).toBe(10);   // 5 doubled
    expect(alpha.round_scores[20]).toBe(2);
    expect(alpha.round_total).toBe(12);
    expect(alpha.total).toBe(12 + 4 + 0 + 2);  // + handicap + brownie + whoami
    expect(alpha.doubled_round_id).toBe(10);

    const beta = res.body.teams.find(t => t.id === 2);
    expect(beta.total).toBe(1 + (-4) + 3 + 0);

    // Sorted by total desc → Alpha first
    expect(res.body.teams[0].id).toBe(1);
  });

  it('does not double anything without a Double Up choice', async () => {
    scoreboardDb({ doubleChoices: [] });
    const res = mockRes();
    await getSessionScoreboard({ params: { sessionId: 1 } }, res);
    const alpha = res.body.teams.find(t => t.id === 1);
    expect(alpha.round_scores[10]).toBe(5);
    expect(alpha.total).toBe(5 + 2 + 4 + 0 + 2);
  });
});
