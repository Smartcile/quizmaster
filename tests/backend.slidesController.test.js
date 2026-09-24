import { describe, it, expect, beforeEach } from 'vitest';
import { setupBackend, mockRes } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/slidesController.js');
const { listSlides, getSlide, createSlide, updateSlideContent, deleteSlide } = controller;

beforeEach(() => db.query.mockReset().mockResolvedValue({ rows: [] }));

describe('listSlides', () => {
  it('builds the WHERE from quiz_id/type/master_id', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await listSlides({ query: { quiz_id: 5, type: 'intro,custom', master_id: 2 } }, mockRes());
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE');
    expect(params[0]).toBe(5);
    expect(params[1]).toEqual(['intro', 'custom']);
    expect(params[2]).toBe(2);
  });
});

describe('getSlide', () => {
  it('404s when missing', async () => {
    const res = mockRes();
    await getSlide({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('createSlide', () => {
  it('400s without a quiz_id and for a bad type', async () => {
    expect((await createSlide({ body: {} }, mockRes())).statusCode).toBe(400);
    expect((await createSlide({ body: { quiz_id: 1, type: 'question' } }, mockRes())).statusCode).toBe(400);
  });

  it('creates an intro slide', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 3, type: 'intro' }] });
    const res = mockRes();
    await createSlide({ body: { quiz_id: 1, type: 'intro' } }, res);
    expect(res.statusCode).toBe(201);
  });
});

describe('updateSlideContent', () => {
  it('400s when content is not an array', async () => {
    const res = mockRes();
    await updateSlideContent({ params: { id: 1 }, body: { content: 'nope' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('404s when the slide is missing', async () => {
    const res = mockRes();
    await updateSlideContent({ params: { id: 1 }, body: { content: [] } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('saves a valid content array', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, content: [] }] });
    const res = mockRes();
    await updateSlideContent({ params: { id: 1 }, body: { content: [] } }, res);
    expect(res.statusCode).toBe(200);
  });
});

describe('deleteSlide', () => {
  it('404s when missing', async () => {
    const res = mockRes();
    await deleteSlide({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });
});
