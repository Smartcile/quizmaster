import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, sockets, controller } = setupBackend('../../backend/controllers/answerController.js');
const { submitAnswer, markAnswer, awardBrowniePoints, getSessionAnswers } = controller;

let emit;
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
  emit = vi.fn();
  sockets.getIo.mockReset().mockReturnValue({ to: vi.fn(() => ({ emit })) });
});

// ── maybeAutoMark, exercised through submitAnswer ─────────────────────────────
function answerClient({ question, existingScore = null, existingAnswer = false } = {}) {
  return mockClient((sql, params) => {
    if (/SELECT id FROM answers/i.test(sql)) return { rows: existingAnswer ? [{ id: 1 }] : [] };
    if (/UPDATE answers SET answer_text/i.test(sql)) return { rows: [{ id: 1, answer_text: params[0] }] };
    if (/INSERT INTO answers/i.test(sql)) return { rows: [{ id: 1, answer_text: params[3] }] };
    if (/SELECT answer, points FROM questions/i.test(sql)) return { rows: question ? [question] : [] };
    if (/SELECT id, auto_marked, points_awarded FROM scores/i.test(sql)) return { rows: existingScore ? [existingScore] : [] };
    if (/INSERT INTO scores/i.test(sql)) return { rows: [{ points_awarded: params[2] }] };
    if (/UPDATE scores SET points_awarded/i.test(sql)) return { rows: [{ points_awarded: params[0] }] };
    if (/UPDATE scores SET marked_answer/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}
const scoreCalls = (client) => client.query.mock.calls.filter(c => /scores/i.test(c[0]));
const submit = (body, client) => {
  db.getClient.mockResolvedValue(client);
  const res = mockRes();
  return submitAnswer({ body }, res).then(() => res);
};

describe('submitAnswer — auto-mark', () => {
  it('awards the full point value for a correct answer when no score exists', async () => {
    const client = answerClient({ question: { answer: 'Paris', points: '2' } });
    const res = await submit({ teamId: 1, roundId: 1, questionId: 9, answerText: 'paris', sessionId: 5 }, client);
    expect(res.statusCode).toBe(201);
    const ins = client.query.mock.calls.find(c => /INSERT INTO scores/i.test(c[0]));
    expect(ins).toBeTruthy();
    expect(ins[1][2]).toBe(2);           // full points, not 1
    expect(ins[1][3]).toBe('paris');     // marked_answer === submitted text
    expect(emit).toHaveBeenCalledWith('answer_marked', expect.objectContaining({ points: 2, autoMarked: true }));
  });

  it('normalises case/whitespace/leading "the " for matching', async () => {
    const client = answerClient({ question: { answer: 'The Moon', points: '1' } });
    await submit({ teamId: 1, roundId: 1, questionId: 9, answerText: '  moon ' }, client);
    expect(client.query.mock.calls.some(c => /INSERT INTO scores/i.test(c[0]))).toBe(true);
  });

  it('writes no score for a wrong answer with no existing score', async () => {
    const client = answerClient({ question: { answer: 'Paris', points: '2' } });
    await submit({ teamId: 1, roundId: 1, questionId: 9, answerText: 'London' }, client);
    expect(scoreCalls(client).some(c => /INSERT INTO scores/i.test(c[0]))).toBe(false);
  });

  it('resets an auto-marked score to 0 when the answer becomes wrong', async () => {
    const client = answerClient({
      question: { answer: 'Paris', points: '2' },
      existingScore: { id: 7, auto_marked: true, points_awarded: '2' },
    });
    await submit({ teamId: 1, roundId: 1, questionId: 9, answerText: 'London' }, client);
    const upd = client.query.mock.calls.find(c => /UPDATE scores SET points_awarded/i.test(c[0]));
    expect(upd[1][0]).toBe(0);
  });

  it('restores full points on an auto-marked score when corrected', async () => {
    const client = answerClient({
      question: { answer: 'Paris', points: '2' },
      existingScore: { id: 7, auto_marked: true, points_awarded: '0' },
    });
    await submit({ teamId: 1, roundId: 1, questionId: 9, answerText: 'Paris' }, client);
    const upd = client.query.mock.calls.find(c => /UPDATE scores SET points_awarded/i.test(c[0]));
    expect(upd[1][0]).toBe(2);
  });

  it('never changes a manually-marked score', async () => {
    const client = answerClient({
      question: { answer: 'Paris', points: '2' },
      existingScore: { id: 7, auto_marked: false, points_awarded: '0.5' },
    });
    await submit({ teamId: 1, roundId: 1, questionId: 9, answerText: 'Paris' }, client);
    expect(client.query.mock.calls.some(c => /UPDATE scores SET points_awarded/i.test(c[0]))).toBe(false);
  });
});

// ── markAnswer (manual marking / deselect) ───────────────────────────────────
function markClient({ existingScore = false, judged = 'Oxford' } = {}) {
  return mockClient((sql, params) => {
    if (/DELETE FROM scores/i.test(sql)) return { rows: [] };
    if (/SELECT id FROM scores/i.test(sql)) return { rows: existingScore ? [{ id: 1 }] : [] };
    if (/SELECT answer_text FROM answers/i.test(sql)) return { rows: judged == null ? [] : [{ answer_text: judged }] };
    return { rows: [] };
  });
}

describe('markAnswer', () => {
  it('deletes the score when points is null (deselect)', async () => {
    const client = markClient({ existingScore: true });
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await markAnswer({ body: { teamId: 1, questionId: 9, points: null, sessionId: 5 } }, res);
    expect(client.query.mock.calls.some(c => /DELETE FROM scores/i.test(c[0]))).toBe(true);
    expect(res.body).toEqual({ ok: true, points: null });
    expect(emit).toHaveBeenCalledWith('answer_marked', expect.objectContaining({ points: null }));
  });

  it('records the judged answer text on a manual mark', async () => {
    const client = markClient({ existingScore: true, judged: 'Oxford' });
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await markAnswer({ body: { teamId: 1, questionId: 9, points: 0.5 } }, res);
    const upd = client.query.mock.calls.find(c => /UPDATE scores SET points_awarded/i.test(c[0]));
    expect(upd[1][0]).toBe(0.5);
    expect(upd[1][1]).toBe('Oxford');   // marked_answer
    expect(res.statusCode).toBe(201);
  });

  it('inserts a new manual score when none exists', async () => {
    const client = markClient({ existingScore: false, judged: 'Paris' });
    db.getClient.mockResolvedValue(client);
    await markAnswer({ body: { teamId: 1, questionId: 9, points: 2 } }, mockRes());
    const ins = client.query.mock.calls.find(c => /INSERT INTO scores/i.test(c[0]));
    expect(ins[1][2]).toBe(2);
    expect(ins[1][3]).toBe('Paris');
  });
});

// ── awardBrowniePoints ───────────────────────────────────────────────────────
describe('awardBrowniePoints', () => {
  it('rejects a missing team or a zero value', async () => {
    const res = mockRes();
    await awardBrowniePoints({ body: { teamId: 0, points: 0 } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('inserts the points and returns the running total', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/INSERT INTO brownie_points/i.test(sql)) return { rows: [{ id: 1, team_id: 3, points: 2 }] };
      if (/SUM\(points\)/i.test(sql)) return { rows: [{ total: '5' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await awardBrowniePoints({ body: { teamId: 3, label: 'Bonus', points: 2, sessionId: 5 } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.team_total).toBe(5);
    expect(emit).toHaveBeenCalledWith('answer_marked', expect.objectContaining({ questionId: null, brownieTotal: 5 }));
  });
});

// ── getSessionAnswers ────────────────────────────────────────────────────────
describe('getSessionAnswers', () => {
  it('404s when the session is unknown', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await getSessionAnswers({ params: { sessionId: 99 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('returns rounds/questions/teams/answers/scores/brownie for the session', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM quiz_sessions WHERE id/i.test(sql)) return { rows: [{ quiz_id: 1 }] };
      if (/FROM quiz_rounds qr/i.test(sql)) return { rows: [{ id: 10, name: 'R1' }] };
      if (/FROM round_questions rq/i.test(sql)) return { rows: [{ id: 100, round_id: 10 }] };
      if (/FROM teams WHERE quiz_session_id/i.test(sql)) return { rows: [{ id: 1, name: 'A', size: 3 }] };
      if (/FROM answers WHERE team_id = ANY/i.test(sql)) return { rows: [{ team_id: 1, question_id: 100, answer_text: 'x' }] };
      if (/FROM scores WHERE team_id = ANY/i.test(sql)) return { rows: [{ team_id: 1, question_id: 100, points_awarded: 1 }] };
      if (/FROM brownie_points/i.test(sql)) return { rows: [{ team_id: 1, total: 2 }] };
      return { rows: [] };
    });
    const res = mockRes();
    await getSessionAnswers({ params: { sessionId: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.rounds).toHaveLength(1);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.answers).toHaveLength(1);
    expect(res.body.scores).toHaveLength(1);
    expect(res.body.brownie).toHaveLength(1);
  });
});
