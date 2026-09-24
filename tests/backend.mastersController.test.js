import { describe, it, expect, beforeEach } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/mastersController.js');
const { deleteMaster, duplicateMaster, setDefaultMaster, getAllMasters } = controller;

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
});

describe('deleteMaster', () => {
  it('404s when the master is missing', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await deleteMaster({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('refuses to delete the protected Default Profile', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ is_default: true }] });
    const res = mockRes();
    await deleteMaster({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Default Profile/i);
  });

  it('refuses while quizzes still reference it, naming them', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ is_default: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, name: 'Quiz Night' }] });
    const res = mockRes();
    await deleteMaster({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.quizzes).toEqual([{ id: 7, name: 'Quiz Night' }]);
  });

  it('deletes an unused, non-default master', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ is_default: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = mockRes();
    await deleteMaster({ params: { id: 1 } }, res);
    expect(res.body).toEqual({ ok: true, id: 1 });
  });
});

describe('duplicateMaster', () => {
  it('404s when the source is missing', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await duplicateMaster({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('copies with a "Copy of" name', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Original', styles: {}, placeholders: [] }] })
      .mockResolvedValueOnce({ rows: [{ id: 2, name: 'Copy of Original' }] });
    const res = mockRes();
    await duplicateMaster({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(201);
    expect(db.query.mock.calls[1][1][0]).toBe('Copy of Original');
  });
});

describe('setDefaultMaster', () => {
  it('404s when the master is missing', async () => {
    db.getClient.mockResolvedValue(mockClient(() => ({ rows: [] })));
    const res = mockRes();
    await setDefaultMaster({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('clears the old default and sets the new one in one transaction', async () => {
    const client = mockClient((sql) => {
      if (/SELECT id FROM slide_masters/i.test(sql)) return { rows: [{ id: 2 }] };
      if (/is_default = TRUE/i.test(sql)) return { rows: [{ id: 2, is_default: true }] };
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await setDefaultMaster({ params: { id: 2 } }, res);
    const clears = client.query.mock.calls.filter(c => /is_default = FALSE WHERE is_default = TRUE/i.test(c[0]));
    expect(clears).toHaveLength(1);
    expect(res.body).toEqual({ id: 2, is_default: true });
  });
});

describe('getAllMasters', () => {
  it('returns rows', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = mockRes();
    await getAllMasters({}, res);
    expect(res.body).toEqual([{ id: 1 }]);
  });
});
