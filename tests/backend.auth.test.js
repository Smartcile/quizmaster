import { describe, it, expect, beforeAll, vi } from 'vitest';
import { backendRequire, mockRes } from './helpers/backend.js';

// auth.js reads env at require time — set them first.
process.env.ADMIN_PASSWORD = 'letmein';
process.env.JWT_SECRET = 'test-secret-123';

let auth;
let jwt;
beforeAll(() => {
  auth = backendRequire('../../backend/middleware/auth.js');
  jwt = backendRequire('../../backend/node_modules/jsonwebtoken');
});

describe('login', () => {
  it('issues a signed admin token for the correct password', () => {
    const res = mockRes();
    auth.login({ body: { password: 'letmein' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.expiresIn).toBe('12h');
    const decoded = jwt.verify(res.body.token, 'test-secret-123');
    expect(decoded.role).toBe('admin');
  });

  it('rejects a wrong or missing password with 401', () => {
    const a = mockRes();
    auth.login({ body: { password: 'nope' } }, a);
    expect(a.statusCode).toBe(401);
    const b = mockRes();
    auth.login({ body: {} }, b);
    expect(b.statusCode).toBe(401);
  });
});

describe('verifyToken', () => {
  it('calls next() for a valid Bearer token', () => {
    const token = jwt.sign({ role: 'admin' }, 'test-secret-123', { expiresIn: '1h' });
    const next = vi.fn();
    const res = mockRes();
    auth.verifyToken({ headers: { authorization: `Bearer ${token}` } }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('401s when the header is missing', () => {
    const next = vi.fn();
    const res = mockRes();
    auth.verifyToken({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('401s for an invalid/expired token', () => {
    const next = vi.fn();
    const res = mockRes();
    auth.verifyToken({ headers: { authorization: 'Bearer not.a.jwt' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('requireAdminForWrites', () => {
  it('lets public reads through without a token', () => {
    const next = vi.fn();
    const res = mockRes();
    auth.requireAdminForWrites({ method: 'GET', headers: {} }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('requires a token for writes', () => {
    const next = vi.fn();
    const res = mockRes();
    auth.requireAdminForWrites({ method: 'POST', headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid token on writes', () => {
    const token = jwt.sign({ role: 'admin' }, 'test-secret-123', { expiresIn: '1h' });
    const next = vi.fn();
    const res = mockRes();
    auth.requireAdminForWrites({ method: 'DELETE', headers: { authorization: `Bearer ${token}` } }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
