import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  api, getToken, setToken, clearToken, setUnauthorizedHandler,
  loginAdmin, verifyAdminToken,
} from './api.js';

// A fake fetch Response.
const jsonRes = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

const realFetch = global.fetch;
beforeEach(() => {
  localStorage.clear();
  setUnauthorizedHandler(() => {});
  global.fetch = vi.fn();
});
afterEach(() => { global.fetch = realFetch; });

describe('token storage', () => {
  it('sets, reads and clears the token', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('request (via api.get/post/put/delete)', () => {
  it('sends the Bearer token when present and parses JSON', async () => {
    setToken('tok');
    global.fetch.mockResolvedValue(jsonRes(200, { ok: true }));
    const data = await api.get('/questions');
    expect(data).toEqual({ ok: true });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/questions');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('omits the Authorization header without a token', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, {}));
    await api.get('/config');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('POST/PUT send a JSON body', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, { id: 1 }));
    await api.post('/questions', { text: 'x' });
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ text: 'x' }) });
    await api.put('/questions/1', { text: 'y' });
    expect(global.fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ text: 'y' }) });
  });

  it('on 401 clears the token, fires the handler and throws a session error', async () => {
    setToken('tok');
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    global.fetch.mockResolvedValue(jsonRes(401, {}));
    await expect(api.get('/x')).rejects.toThrow(/Session expired/i);
    expect(getToken()).toBeNull();
    expect(onUnauth).toHaveBeenCalledOnce();
  });

  it('on other errors throws status + server message', async () => {
    global.fetch.mockResolvedValue(jsonRes(400, { error: 'Bad thing' }));
    await expect(api.post('/x', {})).rejects.toThrow('400: Bad thing');
  });
});

describe('api.upload', () => {
  it('POSTs FormData with the auth header and returns JSON', async () => {
    setToken('tok');
    global.fetch.mockResolvedValue(jsonRes(200, { url: '/uploads/a.png' }));
    const fd = new FormData();
    const out = await api.upload('/upload/media', fd);
    expect(out).toEqual({ url: '/uploads/a.png' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/upload/media');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('401 clears the token and throws', async () => {
    setToken('tok');
    global.fetch.mockResolvedValue({ status: 401, ok: false, text: () => Promise.resolve('') });
    await expect(api.upload('/upload/media', new FormData())).rejects.toThrow(/Session expired/i);
    expect(getToken()).toBeNull();
  });
});

describe('loginAdmin / verifyAdminToken', () => {
  it('stores the token on a successful login', async () => {
    global.fetch.mockResolvedValue(jsonRes(200, { token: 'newtok' }));
    const data = await loginAdmin('pw');
    expect(data.token).toBe('newtok');
    expect(getToken()).toBe('newtok');
  });

  it('throws the server error message on failure', async () => {
    global.fetch.mockResolvedValue(jsonRes(401, { error: 'Invalid password' }));
    await expect(loginAdmin('bad')).rejects.toThrow('Invalid password');
  });

  it('verifyAdminToken is false without a token and true when the server 200s', async () => {
    expect(await verifyAdminToken()).toBe(false);
    setToken('tok');
    global.fetch.mockResolvedValue({ status: 200, ok: true });
    expect(await verifyAdminToken()).toBe(true);
  });

  it('verifyAdminToken is false when the request throws', async () => {
    setToken('tok');
    global.fetch.mockRejectedValue(new Error('offline'));
    expect(await verifyAdminToken()).toBe(false);
  });
});
