import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/repoController.js');
const { addRepo, syncRepo, listRepos, deleteRepo } = controller;

const realFetch = global.fetch;
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
});
afterEach(() => { global.fetch = realFetch; });

const addedParams = () => db.query.mock.calls.find(c => /INSERT INTO question_repos/i.test(c[0]))?.[1];

describe('addRepo — URL parsing', () => {
  it('400s without a URL or for an unrecognised one', async () => {
    expect((await addRepo({ body: {} }, mockRes())).statusCode).toBe(400);
    const res = mockRes();
    await addRepo({ body: { url: 'https://example.com/foo' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('parses a plain repo URL (branch defaults to main)', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await addRepo({ body: { url: 'https://github.com/owner/repo' } }, mockRes());
    expect(addedParams()).toMatchObject({ 0: 'owner/repo', 2: 'owner', 3: 'repo', 4: 'main', 5: '' });
  });

  it('parses a /tree/branch/path link', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await addRepo({ body: { url: 'https://github.com/owner/repo/tree/dev/sub/dir' } }, mockRes());
    const p = addedParams();
    expect(p[2]).toBe('owner');
    expect(p[4]).toBe('dev');
    expect(p[5]).toBe('sub/dir');
  });

  it('parses a raw.githubusercontent.com link', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    await addRepo({ body: { url: 'https://raw.githubusercontent.com/o/r/main/pack/q.csv' } }, mockRes());
    expect(addedParams()).toMatchObject({ 2: 'o', 3: 'r', 4: 'main', 5: 'pack/q.csv' });
  });
});

describe('syncRepo', () => {
  const cfg = { id: 1, owner: 'o', repo: 'r', branch: 'main', path: 'questions.csv' };

  it('404s for an unknown repo', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await syncRepo({ params: { id: 1 }, body: {}, query: {} }, res);
    expect(res.statusCode).toBe(404);
  });

  it('adds new questions and relabels local ones (de-dupe by text)', async () => {
    const csv = 'question,answer\nExisting,a\nBrand New,b\n';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => csv });
    db.query.mockImplementation(async (sql) => {
      if (/FROM question_repos WHERE id/i.test(sql)) return { rows: [cfg] };
      if (/SELECT id, text, answer, options, source, repo_hash FROM questions/i.test(sql)) {
        return { rows: [{ id: 5, text: 'Existing', answer: 'a', options: [], source: 'local', repo_hash: null }] };
      }
      return { rows: [] };
    });
    const client = mockClient();
    db.getClient.mockResolvedValue(client);

    const res = mockRes();
    await syncRepo({ params: { id: 1 }, body: {}, query: {} }, res);
    expect(res.body).toMatchObject({ added: 1, relabeled: 1, files: 1 });
    const relabel = client.query.mock.calls.find(c => /SET source = 'both'/i.test(c[0]));
    expect(relabel[1][1]).toBe(5);
    expect(client.query.mock.calls.some(c => /INSERT INTO questions/i.test(c[0]))).toBe(true);
  });
});

describe('listRepos / deleteRepo', () => {
  it('lists repos', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = mockRes();
    await listRepos({}, res);
    expect(res.body).toEqual([{ id: 1 }]);
  });

  it('404s deleting an unknown repo', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await deleteRepo({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
  });
});
