import { describe, it, expect, beforeEach } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/roundController.js');
const { getAllRounds, getRound, createRound, updateRound, deleteRound } = controller;

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
});

describe('createRound', () => {
  it('stores textlist config and per-question overrides', async () => {
    const client = mockClient((sql) => (/INSERT INTO rounds/i.test(sql) ? { rows: [{ id: 10 }] } : { rows: [] }));
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await createRound({
      body: {
        name: 'Geo', style: 'textlist', list_mode: 'match', list_options: ['Small', 'Large'],
        category: 'Geography', show_images: true, questions: [{ id: 1, question_format_override: 'multichoice' }, { id: 2 }],
      },
    }, res);

    const ins = client.query.mock.calls.find(c => /INSERT INTO rounds/i.test(c[0]));
    expect(ins[1][8]).toBe('Geography');
    expect(ins[1][9]).toBe('match');
    expect(ins[1][10]).toBe(JSON.stringify(['Small', 'Large']));
    expect(ins[1][11]).toBe(true);   // show_images carried

    const rq = client.query.mock.calls.filter(c => /INSERT INTO round_questions/i.test(c[0]));
    expect(rq).toHaveLength(2);
    expect(rq[0][1][3]).toBe('multichoice');   // override carried
    expect(rq[1][1][3]).toBeNull();
    expect(res.statusCode).toBe(201);
  });
});

describe('updateRound', () => {
  it('replaces the round questions when given', async () => {
    const client = mockClient((sql) => {
      if (/UPDATE rounds SET/i.test(sql)) return { rows: [{ id: 10 }] };
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);
    await updateRound({ params: { id: 10 }, body: { name: 'R', questions: [{ id: 1 }] } }, mockRes());
    expect(client.query.mock.calls.some(c => /DELETE FROM round_questions WHERE round_id/i.test(c[0]))).toBe(true);
    expect(client.query.mock.calls.some(c => /INSERT INTO round_questions/i.test(c[0]))).toBe(true);
  });

  it('500s when the round does not exist (throws inside the transaction)', async () => {
    db.getClient.mockResolvedValue(mockClient(() => ({ rows: [] })));
    const res = mockRes();
    await updateRound({ params: { id: 999 }, body: { name: 'R' } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('getAllRounds / getRound / deleteRound', () => {
  it('lists rounds', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = mockRes();
    await getAllRounds({}, res);
    expect(res.body).toEqual([{ id: 1 }]);
  });

  it('adds each round\'s quiz membership via a correlated json_agg', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, quizzes: [{ id: 7, name: 'Friday Quiz', position: 2, created_at: '2026-01-01' }] }] });
    const res = mockRes();
    await getAllRounds({}, res);

    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/quiz_rounds\s+zqr/i);
    expect(sql).toMatch(/JOIN quizzes z/i);
    expect(sql).toMatch(/json_agg/i);
    expect(sql).toMatch(/AS quizzes/i);
    // rows (including the quizzes array) pass straight through
    expect(res.body).toEqual([{ id: 1, quizzes: [{ id: 7, name: 'Friday Quiz', position: 2, created_at: '2026-01-01' }] }]);
  });

  it('404s a missing round', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await getRound({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('404s deleting a missing round', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await deleteRound({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });
});
