import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/adminController.js');
const { resetData } = controller;

beforeEach(() => {
  db.getClient.mockReset();
  vi.restoreAllMocks();
});

// Fake client where each DELETE ... RETURNING reports a rowCount.
function resetClient(counts = {}) {
  return mockClient((sql) => {
    if (/DELETE FROM quiz_sessions/i.test(sql)) return { rows: [], rowCount: counts.sessions ?? 0 };
    if (/DELETE FROM quizzes/i.test(sql)) return { rows: [], rowCount: counts.quizzes ?? 0 };
    if (/DELETE FROM rounds/i.test(sql)) return { rows: [], rowCount: counts.rounds ?? 0 };
    if (/DELETE FROM questions/i.test(sql)) return { rows: [], rowCount: counts.questions ?? 0 };
    if (/SELECT filename FROM media_files/i.test(sql)) return { rows: counts.files || [] };
    if (/DELETE FROM media_files/i.test(sql)) return { rows: [], rowCount: counts.media ?? 0 };
    return { rows: [] };
  });
}

describe('resetData', () => {
  it('400s when nothing is selected', async () => {
    const res = mockRes();
    await resetData({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('wiping questions also clears session data first (FK-safe order)', async () => {
    const client = resetClient({ sessions: 4, questions: 30 });
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await resetData({ body: { questions: true } }, res);

    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls.findIndex(s => /DELETE FROM quiz_sessions/i.test(s)))
      .toBeLessThan(sqls.findIndex(s => /DELETE FROM questions/i.test(s)));
    expect(res.body.deleted).toMatchObject({ sessions: 4, questions: 30 });
    expect(res.body.deleted.quizzes).toBeUndefined();
  });

  it('wiping quizzes clears sessions too', async () => {
    const client = resetClient({ sessions: 2, quizzes: 5 });
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await resetData({ body: { quizzes: true } }, res);
    expect(res.body.deleted).toMatchObject({ sessions: 2, quizzes: 5 });
  });

  it('media wipe removes rows and unlinks files from disk', async () => {
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const client = resetClient({ media: 3, files: [{ filename: 'a.png' }, { filename: 'b.png' }] });
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await resetData({ body: { media: true } }, res);
    expect(res.body.deleted.media).toBe(3);
    expect(unlink).toHaveBeenCalledTimes(2);
  });
});
