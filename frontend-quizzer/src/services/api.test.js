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

describe('quizzer api client', () => {
  it('GETs and parses JSON', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, { quiz: { id: 1 } }));
    expect(await api.get('/quizzes/resolve/ABC123')).toEqual({ quiz: { id: 1 } });
    expect(global.fetch.mock.calls[0][0]).toBe('/api/quizzes/resolve/ABC123');
    expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('POSTs a JSON body', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, { id: 5 }));
    await api.post('/teams/join', { name: 'A' });
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ name: 'A' }) });
  });

  it('PUTs a JSON body', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, { ok: true }));
    await api.put('/teams/1', { size: 3 });
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ size: 3 }) });
  });

  it('throws API error status + text on failure', async () => {
    global.fetch.mockResolvedValue(jsonRes(404, 'not found'));
    await expect(api.get('/x')).rejects.toThrow('API error 404: not found');
  });
});
