import { describe, it, expect, beforeEach } from 'vitest';
import { setupBackend, mockRes } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/answerController.js');
const { exportAnswersCSV, getAnswersByQuestion, getTeamAnswers } = controller;

beforeEach(() => db.query.mockReset().mockResolvedValue({ rows: [] }));

describe('exportAnswersCSV', () => {
  it('404s when there is nothing to export', async () => {
    const res = mockRes();
    await exportAnswersCSV({ query: { sessionId: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('builds a CSV with a header row and quoted/escaped cells', async () => {
    db.query.mockResolvedValue({ rows: [
      { Team: 'Alpha', Round: 'R1', 'Q#': 1, Question: 'Capital?', 'Correct Answer': 'Paris', 'Team Answer': 'Paris', Points: '1' },
      { Team: 'Beta', Round: 'R1', 'Q#': 1, Question: 'Capital?', 'Correct Answer': 'Paris', 'Team Answer': 'Say "hi"', Points: '0' },
    ] });
    const res = mockRes();
    await exportAnswersCSV({ query: { sessionId: 1 } }, res);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('quiz-session-1.csv');
    expect(res.sent.split('\r\n')[0]).toBe('Team,Round,Q#,Question,Correct Answer,Team Answer,Points');
    // Embedded double-quotes are escaped by doubling
    expect(res.sent).toContain('"Say ""hi"""');
  });

  it('adds a round filter when a roundId is supplied', async () => {
    db.query.mockResolvedValue({ rows: [{ Team: 'A' }] });
    await exportAnswersCSV({ query: { sessionId: 1, roundId: 3 } }, mockRes());
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/r\.id = \$2/);
    expect(params).toEqual([1, 3]);
  });
});

describe('getAnswersByQuestion / getTeamAnswers', () => {
  it('returns answers for a question in a session', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = mockRes();
    await getAnswersByQuestion({ query: { questionId: 9, sessionId: 5 } }, res);
    expect(res.body).toEqual([{ id: 1 }]);
    expect(db.query.mock.calls[0][1]).toEqual([9, 5]);
  });

  it('returns a team-round answer set', async () => {
    db.query.mockResolvedValue({ rows: [{ answer_text: 'x' }] });
    const res = mockRes();
    await getTeamAnswers({ query: { teamId: 1, roundId: 2 } }, res);
    expect(res.body).toEqual([{ answer_text: 'x' }]);
  });
});
