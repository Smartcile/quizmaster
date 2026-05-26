// API calls always use /api on the same host - works for localhost, IP, and domain.
// The frontend container's nginx proxies /api -> backend:5000 internally.

const API_BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
  return response.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => fetch(`${API_BASE}${path}`, { method: 'POST', body: formData }).then(r => r.json()),
  baseUrl: () => API_BASE,
};
