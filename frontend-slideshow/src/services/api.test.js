import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from './api.js';

const jsonRes = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

const realFetch = global.fetch;
beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => { global.fetch = realFetch; });

describe('slideshow api client', () => {
  it('GETs and parses JSON', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, { ok: true }));
    expect(await api.get('/quizzes/resolve/ABC123')).toEqual({ ok: true });
    expect(global.fetch.mock.calls[0][0]).toBe('/api/quizzes/resolve/ABC123');
  });

  it('POSTs a JSON body', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, {}));
    await api.post('/x', { a: 1 });
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ a: 1 }) });
  });

  it('throws on failure', async () => {
    global.fetch.mockResolvedValue(jsonRes(500, 'oops'));
    await expect(api.get('/x')).rejects.toThrow('API error 500: oops');
  });
});
