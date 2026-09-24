import { createRequire } from 'node:module';
import { vi } from 'vitest';

// Load the backend's CommonJS modules in isolation. Controllers do
// `const db = require('../config/database')`, so we stub that module in the CJS
// cache BEFORE requiring the controller — the controller captures our fake and
// tests drive it by resetting the mock fns. Same trick for sockets (getIo).
const require = createRequire(import.meta.url);

const DB_PATH = require.resolve('../../backend/config/database.js');
const SOCKETS_PATH = require.resolve('../../backend/sockets.js');

function stubModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

export function setupBackend(controllerRelPath) {
  const db = { query: vi.fn(), getClient: vi.fn(), initializeDatabase: vi.fn(), pool: {} };
  const sockets = { getIo: vi.fn(() => null), setIo: vi.fn() };
  require.cache[DB_PATH] = stubModule(DB_PATH, db);
  require.cache[SOCKETS_PATH] = stubModule(SOCKETS_PATH, sockets);
  const controller = require(controllerRelPath);
  return { db, sockets, controller };
}

export const backendRequire = (rel) => require(rel);

// A fake Express response that records status/json/send/setHeader.
export function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.sent = undefined;
  res.headers = {};
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.send = vi.fn((b) => { res.sent = b; return res; });
  res.setHeader = vi.fn((k, v) => { res.headers[k.toLowerCase()] = v; });
  return res;
}

// A fake transactional client. `router(sql, params)` returns { rows } (or
// undefined for { rows: [] }). BEGIN/COMMIT/ROLLBACK are handled automatically.
export function mockClient(router) {
  return {
    query: vi.fn(async (sql, params) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) return { rows: [] };
      const r = router ? router(sql, params) : null;
      return r || { rows: [] };
    }),
    release: vi.fn(),
  };
}
