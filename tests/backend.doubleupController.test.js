import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupBackend, mockRes } from './helpers/backend.js';

const { db, sockets, controller } = setupBackend('../../backend/controllers/doubleupController.js');
const { getSessionChoices, chooseRound, adminSetRound } = controller;

let emit;
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  emit = vi.fn();
  sockets.getIo.mockReset().mockReturnValue({ to: vi.fn(() => ({ emit })) });
});

describe('getSessionChoices', () => {
  it('returns the choices wrapped in an object', async () => {
    db.query.mockResolvedValue({ rows: [{ team_id: 1, round_id: 2 }] });
    const res = mockRes();
    await getSessionChoices({ params: { sessionId: 5 } }, res);
    expect(res.body).toEqual({ choices: [{ team_id: 1, round_id: 2 }] });
  });
});

describe('chooseRound', () => {
  it('400s when fields are missing', async () => {
    expect((await chooseRound({ body: { sessionId: 1 } }, mockRes())).statusCode).toBe(400);
  });

  it('404s for an unknown session', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await chooseRound({ body: { sessionId: 1, teamId: 2, roundId: 3 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('409s when the target round is already locked', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ locked_round_ids: [3] }] });
    const res = mockRes();
    await chooseRound({ body: { sessionId: 1, teamId: 2, roundId: 3 } }, res);
    expect(res.statusCode).toBe(409);
  });

  it('409s when the team current pick round is already locked (frozen)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ locked_round_ids: [9] }] })   // session: round 9 locked
      .mockResolvedValueOnce({ rows: [{ round_id: 9 }] });            // team's existing pick = 9
    const res = mockRes();
    await chooseRound({ body: { sessionId: 1, teamId: 2, roundId: 4 } }, res);
    expect(res.statusCode).toBe(409);
  });

  it('upserts a valid pick and broadcasts it', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ locked_round_ids: [] }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ team_id: '2', round_id: '4' }] });
    const res = mockRes();
    await chooseRound({ body: { sessionId: 1, teamId: 2, roundId: 4 } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ teamId: 2, roundId: 4 });
    expect(emit).toHaveBeenCalledWith('doubleup_chosen', expect.objectContaining({ teamId: 2, roundId: 4 }));
  });
});

describe('adminSetRound', () => {
  it('400s without sessionId/teamId', async () => {
    expect((await adminSetRound({ body: { sessionId: 1 } }, mockRes())).statusCode).toBe(400);
  });

  it('404s when the team is not in the session', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await adminSetRound({ body: { sessionId: 1, teamId: 2, roundId: 3 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('ignores the lock rules (host override) and sets a round', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 2 }] })   // team found
      .mockResolvedValueOnce({ rows: [] });           // upsert
    const res = mockRes();
    await adminSetRound({ body: { sessionId: 1, teamId: 2, roundId: 3 } }, res);
    expect(db.query.mock.calls.some(c => /INSERT INTO double_up_choices/i.test(c[0]))).toBe(true);
    expect(emit).toHaveBeenCalledWith('doubleup_chosen', expect.objectContaining({ roundId: 3, byAdmin: true }));
  });

  it('clears the pick when roundId is null', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await adminSetRound({ body: { sessionId: 1, teamId: 2, roundId: null } }, res);
    expect(db.query.mock.calls.some(c => /DELETE FROM double_up_choices/i.test(c[0]))).toBe(true);
    expect(emit).toHaveBeenCalledWith('doubleup_chosen', expect.objectContaining({ roundId: null, byAdmin: true }));
  });
});
