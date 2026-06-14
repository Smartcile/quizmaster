const db = require('../config/database');

// Global admin settings — a small key/value store applied across all users and
// surfaces (unlike the browser-local Quiz Control test settings).

// GET /api/settings → flat object { key: value, ... }
async function getSettings(req, res) {
  try {
    const r = await db.query('SELECT key, value FROM app_settings');
    const out = {};
    for (const row of r.rows) out[row.key] = row.value;
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// PUT /api/settings — upsert one or more keys. Body: { key: value, ... }
async function updateSettings(req, res) {
  try {
    const body = req.body || {};
    const keys = Object.keys(body);
    if (!keys.length) return res.status(400).json({ error: 'No settings provided' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const k of keys) {
        await client.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [k, JSON.stringify(body[k])]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const r = await db.query('SELECT key, value FROM app_settings');
    const out = {};
    for (const row of r.rows) out[row.key] = row.value;
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { getSettings, updateSettings };
