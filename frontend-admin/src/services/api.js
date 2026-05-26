// Frontend-admin API client. Bundled nginx proxies /api -> backend service.
// Auth token kept in localStorage and sent on every request.

const API_BASE = '/api';
const TOKEN_KEY = 'qm_admin_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(token) { localStorage.setItem(TOKEN_KEY, token); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (response.status === 401) {
    clearToken();
    onUnauthorized();
    throw new Error('Session expired - please log in again');
  }

  if (!response.ok) {
    let msg;
    try { msg = (await response.json()).error || response.statusText; }
    catch { msg = await response.text() || response.statusText; }
    throw new Error(`${response.status}: ${msg}`);
  }

  return response.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => {
    const token = getToken();
    return fetch(`${API_BASE}${path}`, {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }).then(async r => {
      if (r.status === 401) { clearToken(); onUnauthorized(); throw new Error('Session expired'); }
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    });
  },
  baseUrl: () => API_BASE,
};

export async function loginAdmin(password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Login failed');
  }
  const data = await res.json();
  setToken(data.token);
  return data;
}

export async function verifyAdminToken() {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.ok;
  } catch {
    return false;
  }
}
