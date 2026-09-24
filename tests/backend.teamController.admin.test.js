import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupBackend, mockRes } from './helpers/backend.js';

const { db, sockets, controller } = setupBackend('../../backend/controllers/teamController.js');
const { createTeamAdmin, updateTeam, deleteTeam, getTeamById, getTeamByDevice, getTeamAnswers, getTeamScores } = controller;

let emit;
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  emit = vi.fn();
  sockets.getIo.mockReset().mockReturnValue({ to: vi.fn(() => ({ emit })) });
});

describe('createTeamAdmin', () => {
  it('400s without a name and 404s for an unknown session', async () => {
    expect((await createTeamAdmin({ body: {} }, mockRes())).statusCode).toBe(400);
    db.query.mockResolvedValue({ rows: [] });
    expect((await createTeamAdmin({ body: { sessionId: 1, name: 'A' } }, mockRes())).statusCode).toBe(404);
  });

  it('reuses an existing team (fuzzy name) or creates a new one + broadcasts', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (/SELECT id FROM quiz_sessions/i.test(sql)) return { rows: [{ id: 1 }] };
      if (/SELECT \* FROM teams WHERE quiz_session_id/i.test(sql)) return { rows: [{ id: 7, name: 'The Kings', size: 4 }] };
      return { rows: [] };
    });
    const res = mockRes();
    await createTeamAdmin({ body: { sessionId: 1, name: 'the kings' } }, res);
    expect(res.statusCode).toBe(200);           // reused, not created
    expect(res.body.id).toBe(7);
    expect(emit).toHaveBeenCalledWith('team_joined', expect.objectContaining({ teamId: 7 }));
  });

  it('creates a genuinely new team (201)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT id FROM quiz_sessions/i.test(sql)) return { rows: [{ id: 1 }] };
      if (/SELECT \* FROM teams WHERE quiz_session_id/i.test(sql)) return { rows: [] };
      if (/INSERT INTO teams/i.test(sql)) return { rows: [{ id: 8, name: 'New', size: 3 }] };
      return { rows: [] };
    });
    const res = mockRes();
    await createTeamAdmin({ body: { sessionId: 1, name: 'New', size: 3 } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe(8);
  });
});

describe('updateTeam', () => {
  it('404s for an unknown team', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect((await updateTeam({ params: { teamId: 1 }, body: { size: 2 } }, mockRes())).statusCode).toBe(404);
  });

  it('400s on an invalid size', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'A', size: 4, is_paper: false, quiz_session_id: 1 }] });
    const res = mockRes();
    await updateTeam({ params: { teamId: 1 }, body: { size: 0 } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('updates size/name/paper and broadcasts team_updated', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'A', size: 4, is_paper: false, quiz_session_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Renamed', size: 5, is_paper: true, quiz_session_id: 2 }] });
    const res = mockRes();
    await updateTeam({ params: { teamId: 1 }, body: { size: 5, name: 'Renamed', is_paper: true } }, res);
    expect(res.body).toMatchObject({ name: 'Renamed', size: 5, is_paper: true });
    expect(emit).toHaveBeenCalledWith('team_updated', expect.objectContaining({ teamId: 1, teamSize: 5 }));
  });
});

describe('deleteTeam / lookups', () => {
  it('deleteTeam 404s and otherwise deletes + broadcasts', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    expect((await deleteTeam({ params: { teamId: 1 } }, mockRes())).statusCode).toBe(404);

    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'A', quiz_session_id: 2 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await deleteTeam({ params: { teamId: 1 } }, res);
    expect(res.body).toEqual({ ok: true });
    expect(emit).toHaveBeenCalledWith('team_removed', expect.objectContaining({ teamId: 1 }));
  });

  it('getTeamById 404s when missing', async () => {
    expect((await getTeamById({ params: { teamId: 1 } }, mockRes())).statusCode).toBe(404);
  });

  it('getTeamByDevice requires a deviceId then 404s when none', async () => {
    expect((await getTeamByDevice({ params: { sessionId: 1 } }, mockRes())).statusCode).toBe(400);
    expect((await getTeamByDevice({ params: { sessionId: 1, deviceId: 'd' } }, mockRes())).statusCode).toBe(404);
  });

  it('getTeamAnswers returns rows', async () => {
    db.query.mockResolvedValue({ rows: [{ question_id: 1 }] });
    const res = mockRes();
    await getTeamAnswers({ params: { teamId: 1 } }, res);
    expect(res.body).toEqual([{ question_id: 1 }]);
  });

  it('getTeamScores 404s when missing', async () => {
    expect((await getTeamScores({ params: { teamId: 1 } }, mockRes())).statusCode).toBe(404);
  });
});
