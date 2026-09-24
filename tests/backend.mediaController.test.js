import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { setupBackend, mockRes } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/mediaController.js');
const { listMedia, getMediaUsage, deleteMedia, listFolders, updateMedia, fetchLyrics } = controller;

const realFetch = global.fetch;
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  vi.restoreAllMocks();
});
afterEach(() => { global.fetch = realFetch; });

describe('listMedia', () => {
  it('labels each file with its usage and sets in_use', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM media_files ORDER BY/i.test(sql)) return { rows: [{ id: 1, filename: 'a.png', url: '/uploads/a.png' }] };
      if (/FROM questions WHERE media_url/i.test(sql)) return { rows: [{ count: '2' }] };
      if (/FROM slide_masters WHERE background_image_url/i.test(sql)) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await listMedia({}, res);
    expect(res.body[0]).toMatchObject({ in_use: true, labels: ['Question'] });
  });
});

describe('getMediaUsage', () => {
  it('404s for a missing file', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await getMediaUsage({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('deleteMedia', () => {
  it('404s for a missing file', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await deleteMedia({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('409s when the file is still referenced', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM media_files/i.test(sql)) return { rows: [{ id: 1, filename: 'a.png', url: '/u/a.png' }] };
      if (/FROM questions WHERE media_url/i.test(sql)) return { rows: [{ count: '1' }] };
      if (/FROM slide_masters/i.test(sql)) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await deleteMedia({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
  });

  it('deletes from disk + DB when unused', async () => {
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    db.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM media_files/i.test(sql)) return { rows: [{ id: 1, filename: 'a.png', url: '/u/a.png' }] };
      if (/FROM questions WHERE media_url/i.test(sql)) return { rows: [{ count: '0' }] };
      if (/FROM slide_masters/i.test(sql)) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });
    const res = mockRes();
    await deleteMedia({ params: { id: 1 } }, res);
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('listFolders', () => {
  it('returns the distinct folder names', async () => {
    db.query.mockResolvedValue({ rows: [{ folder: 'Music' }, { folder: 'Pics' }] });
    const res = mockRes();
    await listFolders({}, res);
    expect(res.body).toEqual(['Music', 'Pics']);
  });
});

describe('updateMedia', () => {
  it('400s when nothing is provided', async () => {
    const res = mockRes();
    await updateMedia({ params: { id: 1 }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('renames (display_name) without touching the url', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, display_name: 'Nice' }] });
    const res = mockRes();
    await updateMedia({ params: { id: 1 }, body: { display_name: 'Nice' } }, res);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/display_name = \$1/);
    expect(sql).not.toMatch(/url =/);
    expect(params).toEqual(['Nice', 1]);
  });

  it('404s when the file is missing', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await updateMedia({ params: { id: 1 }, body: { folder: 'X' } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('fetchLyrics', () => {
  it('404s for a missing file', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await fetchLyrics({ params: { id: 1 }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });

  it('400s when artist/title are unknown', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1, artist: null, title: null }] });
    const res = mockRes();
    await fetchLyrics({ params: { id: 1 }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('saves the synced lyrics found on LRCLIB', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT \* FROM media_files/i.test(sql)) return { rows: [{ id: 1, artist: 'A', title: 'T', album: null, duration_seconds: 100 }] };
      if (/UPDATE media_files SET lyrics/i.test(sql)) return { rows: [{ id: 1, lyrics: '[00:01] hi', lyrics_synced: true }] };
      return { rows: [] };
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ syncedLyrics: '[00:01] hi' }) });
    const res = mockRes();
    await fetchLyrics({ params: { id: 1 }, body: {} }, res);
    expect(res.body.lyrics_synced).toBe(true);
  });
});
