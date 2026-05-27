const db = require('../config/database');

async function getAllMasters(req, res) {
  try {
    const result = await db.query('SELECT * FROM slide_masters ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMaster(req, res) {
  try {
    const result = await db.query('SELECT * FROM slide_masters WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Master not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createMaster(req, res) {
  try {
    const { name, background_color, background_image_url, styles, placeholders } = req.body;
    const result = await db.query(
      `INSERT INTO slide_masters (name, background_color, background_image_url, styles, placeholders)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, background_color || '#0a0e1f', background_image_url || null,
       JSON.stringify(styles || {}), JSON.stringify(placeholders || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateMaster(req, res) {
  try {
    const { name, background_color, background_image_url, styles, placeholders, templates } = req.body;
    const result = await db.query(
      `UPDATE slide_masters
       SET name=$1, background_color=$2, background_image_url=$3,
           styles=$4, placeholders=$5, templates=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [name, background_color, background_image_url || null,
       JSON.stringify(styles || {}), JSON.stringify(placeholders || []),
       JSON.stringify(templates || {}),
       req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Master not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function duplicateMaster(req, res) {
  try {
    const orig = await db.query('SELECT * FROM slide_masters WHERE id = $1', [req.params.id]);
    if (!orig.rows.length) return res.status(404).json({ error: 'Master not found' });
    const m = orig.rows[0];
    const result = await db.query(
      `INSERT INTO slide_masters (name, background_color, background_image_url, styles, placeholders, templates)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [`Copy of ${m.name}`, m.background_color, m.background_image_url,
       JSON.stringify(m.styles), JSON.stringify(m.placeholders),
       JSON.stringify(m.templates || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAllMasters, getMaster, createMaster, updateMaster, duplicateMaster };
