import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/questionController.js');
const {
  getAllQuestions, getCategories, getStats, getQuestion,
  createQuestion, updateQuestion, importQuestions,
  cleanSpecialCharacters, bulkDeleteQuestions,
} = controller;

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
});

const insertParams = () => db.query.mock.calls.find(c => /INSERT INTO questions/i.test(c[0]))?.[1];

describe('getAllQuestions', () => {
  it('builds a WHERE from the filters (search hits text OR answer)', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = mockRes();
    await getAllQuestions({ query: { category: 'History', difficulty: 'hard', approved: 'true', search: 'rome' } }, res);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE');
    expect(sql).toContain('text ILIKE');
    expect(params).toContain('History');
    expect(params).toContain('hard');
    expect(params).toContain(true);
    expect(params).toContain('%rome%');
    expect(res.body).toEqual([{ id: 1 }]);
  });

  it('omits the WHERE when no filters are set', async () => {
    await getAllQuestions({ query: {} }, mockRes());
    expect(db.query.mock.calls[0][0]).not.toContain('WHERE');
  });
});

describe('getCategories / getStats / getQuestion', () => {
  it('returns category names', async () => {
    db.query.mockResolvedValue({ rows: [{ name: 'A' }, { name: 'B' }] });
    const res = mockRes();
    await getCategories({}, res);
    expect(res.body).toEqual(['A', 'B']);
  });

  it('aggregates stats', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ difficulty: 'hard', count: 4 }] })
      .mockResolvedValueOnce({ rows: [{ category: 'History', count: 4 }] });
    const res = mockRes();
    await getStats({}, res);
    expect(res.body).toMatchObject({ questions: 10, rounds: 3, quizzes: 2, activeSessions: 1 });
    expect(res.body.byDifficulty).toHaveLength(1);
  });

  it('404s a missing question', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await getQuestion({ params: { id: 9 } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('createQuestion', () => {
  it('cleans text and promotes an options-carrying question to MCQ', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await createQuestion({
      body: { text: 'It\u2019s a \u201Ctest\u201D', answer: 'A', options: ['A', 'B'], answer_mode: 'text' },
    }, mockRes());
    const p = insertParams();
    expect(p[0]).toBe("It's a \"test\"");  // special chars cleaned
    expect(p[9]).toBe('mcq');              // answer_mode
    expect(p[11]).toBe('multichoice');     // question_format
  });

  it('keeps a Who/What Am I as a plain text question (clues in options)', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await createQuestion({
      body: { text: 'Who?', answer: 'Einstein', is_whoami: true, options: [{ text: 'clue', points: 5 }] },
    }, mockRes());
    const p = insertParams();
    expect(p[9]).toBe('text');
    expect(p[11]).toBe('standard');
    expect(p[12]).toBe(true);              // is_whoami
  });

  it('stores audio-only fields only for audio questions', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await createQuestion({
      body: { text: 'Song', answer: 'x', type: 'audio', audio_form: 'finish_the_lyrics', audio_stop_seconds: '18.5', lyrics: 'la la' },
    }, mockRes());
    const p = insertParams();
    expect(p[13]).toBe('finish_the_lyrics');
    expect(p[14]).toBe(18.5);
    expect(p[15]).toBe('la la');

    db.query.mockClear().mockResolvedValue({ rows: [{ id: 2 }] });
    await createQuestion({ body: { text: 'Q', answer: 'a', type: 'text', audio_form: 'finish_the_lyrics' } }, mockRes());
    expect(insertParams()[13]).toBeNull();
  });
});

describe('updateQuestion', () => {
  it('404s when the row does not exist', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await updateQuestion({ params: { id: 1 }, body: { text: 'x', answer: 'y' } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('importQuestions', () => {
  it('400s when items is not an array', async () => {
    const res = mockRes();
    await importQuestions({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('applies add / copy / overwrite / ignore and returns a summary', async () => {
    const client = mockClient();
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await importQuestions({
      body: { items: [
        { action: 'add', question: { text: 'A', answer: '1' } },
        { action: 'copy', question: { text: 'B', answer: '2' } },
        { action: 'overwrite', existingId: 5, question: { text: 'C', answer: '3' } },
        { action: 'ignore', question: { text: 'D', answer: '4' } },
      ] },
    }, res);
    expect(res.body.added).toEqual(['A']);
    expect(res.body.copied).toEqual(['B (COPY)']);
    expect(res.body.overwritten).toEqual(['C']);
    expect(res.body.ignored).toBe(1);
  });
});

describe('cleanSpecialCharacters', () => {
  it('rewrites only the rows that actually change', async () => {
    db.query.mockResolvedValue({ rows: [
      { id: 1, text: 'It\u2019s', answer: 'x', options: [] },
      { id: 2, text: 'Clean', answer: 'y', options: [] },
    ] });
    const client = mockClient();
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await cleanSpecialCharacters({}, res);
    expect(res.body).toMatchObject({ cleaned: 1, total: 2 });
    const updates = client.query.mock.calls.filter(c => /UPDATE questions SET text/i.test(c[0]));
    expect(updates).toHaveLength(1);
    expect(updates[0][1][3]).toBe(1);   // only row id 1
  });
});

describe('bulkDeleteQuestions', () => {
  it('400s with no ids', async () => {
    const res = mockRes();
    await bulkDeleteQuestions({ body: { ids: [] } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('clears dependent scores/answers then deletes the questions', async () => {
    const client = mockClient((sql) => (/DELETE FROM questions/i.test(sql) ? { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 } : { rows: [] }));
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await bulkDeleteQuestions({ body: { ids: [1, 2] } }, res);
    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls.some(s => /DELETE FROM scores/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM answers/i.test(s))).toBe(true);
    expect(res.body).toEqual({ deleted: 2 });
  });
});
