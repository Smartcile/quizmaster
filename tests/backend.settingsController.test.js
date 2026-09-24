import { describe, it, expect, beforeEach } from 'vitest';
import { setupBackend, mockRes, mockClient } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/controllers/settingsController.js');
const { getSettings, updateSettings } = controller;

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.getClient.mockReset();
});

describe('getSettings', () => {
  it('flattens rows into a key/value object', async () => {
    db.query.mockResolvedValue({ rows: [{ key: 'a', value: true }, { key: 'b', value: 'x' }] });
    const res = mockRes();
    await getSettings({}, res);
    expect(res.body).toEqual({ a: true, b: 'x' });
  });
});

describe('updateSettings', () => {
  it('400s with no keys', async () => {
    const res = mockRes();
    await updateSettings({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('upserts each key (JSON-encoded) then returns the store', async () => {
    const client = mockClient();
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [{ key: 'flag', value: true }] });
    const res = mockRes();
    await updateSettings({ body: { flag: true } }, res);
    const ins = client.query.mock.calls.find(c => /INSERT INTO app_settings/i.test(c[0]));
    expect(ins[1]).toEqual(['flag', 'true']);
    expect(res.body).toEqual({ flag: true });
  });
});
