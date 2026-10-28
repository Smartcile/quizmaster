import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const deepseek = require('../backend/services/deepseek.js');

let img;

beforeEach(() => {
  img = path.join(os.tmpdir(), `qm-deepseek-${Date.now()}-${Math.random()}.jpg`);
  fs.writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try { fs.unlinkSync(img); } catch { /* temp file already gone */ }
});

describe('deepseek service', () => {
  it('reports configured only when a key is set', () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(deepseek.isConfigured()).toBe(false);
    process.env.DEEPSEEK_API_KEY = 'test-key';
    expect(deepseek.isConfigured()).toBe(true);
  });

  it('refuses to call the API without a key', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(deepseek.transcribeAnswerSheet(img, 2)).rejects.toThrow(/not configured/i);
  });

  it('sends the image and parses a fenced JSON reply', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n{"answers":["Paris","B",""]}\n```' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await deepseek.transcribeAnswerSheet(img, 3);
    expect(out).toEqual(['Paris', 'B', '']);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content[0].text).toContain('3 numbered answer rows');
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('throws a readable error on a non-OK response', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' }));
    await expect(deepseek.transcribeAnswerSheet(img, 1)).rejects.toThrow(/AI request failed \(401\)/);
  });
});
