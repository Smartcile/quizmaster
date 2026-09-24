import { describe, it, expect, beforeEach } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/categoriesController.js');
const { createCategory, updateCategory, deleteCategory, getAllCategories } = controller;

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
});

describe('createCategory', () => {
  it('400s without a name', async () => {
    const res = mockRes();
    await createCategory({ body: { name: '  ' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('creates a category (default sort_order 999)', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, name: 'Food' }] });
    const res = mockRes();
    await createCategory({ body: { name: 'Food' } }, res);
    expect(res.statusCode).toBe(201);
    expect(db.query.mock.calls[0][1]).toEqual(['Food', 999]);
  });

  it('409s on a duplicate (unique violation)', async () => {
    db.query.mockRejectedValue({ code: '23505' });
    const res = mockRes();
    await createCategory({ body: { name: 'Food' } }, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('updateCategory', () => {
  it('404s for an unknown id', async () => {
    const client = mockClient(() => ({ rows: [] }));  // SELECT name returns []
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await updateCategory({ params: { id: 1 }, body: { name: 'X' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('renames and propagates the new name to questions', async () => {
    const client = mockClient((sql) => {
      if (/SELECT name FROM categories/i.test(sql)) return { rows: [{ name: 'Old' }] };
      if (/UPDATE categories/i.test(sql)) return { rows: [{ id: 1, name: 'New' }] };
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await updateCategory({ params: { id: 1 }, body: { name: 'New' } }, res);
    const prop = client.query.mock.calls.find(c => /UPDATE questions SET category/i.test(c[0]));
    expect(prop[1]).toEqual(['New', 'Old']);
    expect(res.body).toEqual({ id: 1, name: 'New' });
  });

  it('does not touch questions when the name is unchanged', async () => {
    const client = mockClient((sql) => {
      if (/SELECT name FROM categories/i.test(sql)) return { rows: [{ name: 'Same' }] };
      if (/UPDATE categories/i.test(sql)) return { rows: [{ id: 1, name: 'Same' }] };
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);
    await updateCategory({ params: { id: 1 }, body: { name: 'Same' } }, mockRes());
    expect(client.query.mock.calls.some(c => /UPDATE questions/i.test(c[0]))).toBe(false);
  });
});

describe('deleteCategory', () => {
  it('404s for an unknown id', async () => {
    db.getClient.mockResolvedValue(mockClient(() => ({ rows: [] })));
    const res = mockRes();
    await deleteCategory({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('nulls the category on questions then deletes the row (questions survive)', async () => {
    const client = mockClient((sql) => (/SELECT name FROM categories/i.test(sql) ? { rows: [{ name: 'Old' }] } : { rows: [] }));
    db.getClient.mockResolvedValue(client);
    const res = mockRes();
    await deleteCategory({ params: { id: 1 } }, res);
    const nulled = client.query.mock.calls.find(c => /UPDATE questions SET category = NULL/i.test(c[0]));
    expect(nulled[1]).toEqual(['Old']);
    expect(client.query.mock.calls.some(c => /DELETE FROM categories/i.test(c[0]))).toBe(true);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('getAllCategories', () => {
  it('returns the rows', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, name: 'A' }] });
    const res = mockRes();
    await getAllCategories({}, res);
    expect(res.body).toEqual([{ id: 1, name: 'A' }]);
  });
});
