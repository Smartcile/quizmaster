import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

// Stub the DeepSeek service BEFORE the controller is required, so the controller
// captures our fake instead of hitting the network.
const nodeRequire = createRequire(import.meta.url);
const DEEPSEEK_PATH = nodeRequire.resolve('../backend/services/deepseek.js');
const deepseek = { isConfigured: vi.fn(() => true), transcribeAnswerSheet: vi.fn() };
nodeRequire.cache[DEEPSEEK_PATH] = {
  id: DEEPSEEK_PATH, filename: DEEPSEEK_PATH, loaded: true,
  exports: deepseek, children: [], paths: []
};

const { db, sockets, controller } = setupBackend('../../backend/controllers/teamPhotoController.js');
const { transcribePhoto } = controller;

let emitSpy;

beforeEach(() => {
  deepseek.isConfigured.mockReset().mockReturnValue(true);
  deepseek.transcribeAnswerSheet.mockReset().mockResolvedValue(['Paris', 'B', '']);

  db.query.mockReset();
  db.getClient.mockReset();

  emitSpy = vi.fn();
  sockets.getIo.mockReset().mockReturnValue({ to: () => ({ emit: emitSpy }) });

  db.query.mockImplementation(async (sql) => {
    if (/FROM team_photos/i.test(sql)) {
      return { rows: [{ id: 9, team_id: 7, round_id: 3, filename: 'sheet.jpg', url: '/uploads/sheet.jpg', quiz_session_id: 5 }] };
    }
    if (/FROM round_questions/i.test(sql)) {
      return { rows: [
        { id: 101, options: [], order: 1 },
        { id: 102, options: ['Venus', 'Mercury', 'Mars'], order: 2 },
        { id: 103, options: [], order: 3 },
      ] };
    }
    return { rows: [] };
  });

  const client = mockClient((sql, params) => {
    if (/SELECT id FROM answers/i.test(sql)) {
      return params[1] === 102 ? { rows: [{ id: 22 }] } : { rows: [] };
    }
    if (/SELECT answer, points FROM questions/i.test(sql)) {
      const byId = { 101: ['Paris', '1'], 102: ['Mercury', '2'], 103: ['Rome', '1'] };
      const [answer, points] = byId[params[0]] || [null, '1'];
      return { rows: [{ answer, points }] };
    }
    if (/SELECT id, auto_marked, points_awarded FROM scores/i.test(sql)) return { rows: [] };
    if (/INSERT INTO scores/i.test(sql)) return { rows: [{ points_awarded: params[2] }] };
    return { rows: [] };
  });
  db.getClient.mockResolvedValue(client);
});

describe('teamPhotoController.transcribePhoto', () => {
  it('transcribes, maps MCQ letters to option text, writes answers and auto-marks', async () => {
    const res = mockRes();
    await transcribePhoto({ params: { photoId: '9' } }, res);

    expect(res.statusCode).toBe(200);
    expect(deepseek.transcribeAnswerSheet).toHaveBeenCalledWith(expect.stringContaining('sheet.jpg'), 3);
    expect(res.body.answers).toEqual([
      { questionId: 101, answer: 'Paris', points: 1 },
      { questionId: 102, answer: 'Mercury', points: 2 }, // "B" → option 2
      { questionId: 103, answer: '', points: null },     // blank always scores null
    ]);

    const events = emitSpy.mock.calls.map(c => c[0]);
    expect(events).toContain('answer_submitted');
    expect(events.filter(e => e === 'answer_marked')).toHaveLength(2);
  });

  it('returns 503 with a clear message when AI is not configured', async () => {
    deepseek.isConfigured.mockReturnValue(false);
    const res = mockRes();
    await transcribePhoto({ params: { photoId: '9' } }, res);
    expect(res.statusCode).toBe(503);
    expect(String(res.body.error)).toMatch(/not configured/i);
  });

  it('rejects a photo that is not linked to a round', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 9, team_id: 7, round_id: null, filename: 'sheet.jpg', quiz_session_id: 5 }] });
    const res = mockRes();
    await transcribePhoto({ params: { photoId: '9' } }, res);
    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toMatch(/not linked to a round/i);
  });
});
