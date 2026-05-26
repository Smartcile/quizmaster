// Reads runtime config from window.APP_CONFIG (set in /public/config.js)
// Falls back to dynamic hostname for local development.

function getApiBase() {
  const cfg = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
  if (cfg.API_URL) {
    // Absolute URL (https://smartcile.com/api) or relative path (/api)
    return cfg.API_URL.endsWith('/') ? cfg.API_URL.slice(0, -1) : cfg.API_URL;
  }
  return `${window.location.protocol}//${window.location.hostname}:5000/api`;
}

const API_BASE = getApiBase();

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
