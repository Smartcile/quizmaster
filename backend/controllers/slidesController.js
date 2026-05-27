const db = require('../config/database');

async function listSlides(req, res) {
  try {
    const { quiz_id, type, master_id } = req.query;
    const conditions = [];
    const params = [];

    if (quiz_id) {
      params.push(quiz_id);
      conditions.push(`s.quiz_id = $${params.length}`);
    }
    if (type) {
      const types = type.split(',').map(t => t.trim()).filter(Boolean);
      params.push(types);
      conditions.push(`s.type = ANY($${params.length}::slide_type[])`);
    }
    if (master_id) {
      params.push(master_id);
      conditions.push(`s.master_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT s.id, s.quiz_id, s.master_id, s.type, s."order", s.content, s.created_at,
              q.name AS quiz_name
       FROM slides s
       LEFT JOIN quizzes q ON s.quiz_id = q.id
       ${where}
       ORDER BY q.name, s."order"`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSlide(req, res) {
  try {
    const result = await db.query(
      `SELECT s.id, s.quiz_id, s.master_id, s.type, s."order", s.content,
              s.created_at, s.updated_at,
              CASE WHEN sm.id IS NOT NULL THEN json_build_object(
                'id',                  sm.id,
                'name',                sm.name,
                'background_color',    sm.background_color,
                'background_image_url',sm.background_image_url,
                'styles',              sm.styles,
                'placeholders',        sm.placeholders
              ) ELSE NULL END AS master
       FROM slides s
       LEFT JOIN slide_masters sm ON s.master_id = sm.id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Slide not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createSlide(req, res) {
  try {
    const { quiz_id, master_id, type, order } = req.body;
    if (!quiz_id) return res.status(400).json({ error: 'quiz_id required' });
    if (!['intro', 'custom'].includes(type)) {
      return res.status(400).json({ error: 'type must be intro or custom' });
    }
    const result = await db.query(
      `INSERT INTO slides (quiz_id, master_id, type, "order", content)
       VALUES ($1, $2, $3::slide_type, $4, '[]'::jsonb) RETURNING *`,
      [quiz_id, master_id || null, type, order ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateSlideContent(req, res) {
  try {
    const { content } = req.body;
    if (!Array.isArray(content)) {
      return res.status(400).json({ error: 'content must be a JSON array' });
    }
    const result = await db.query(
      `UPDATE slides SET content = $1::jsonb, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [JSON.stringify(content), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Slide not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteSlide(req, res) {
  try {
    const result = await db.query('DELETE FROM slides WHERE id = $1 RETURNING *', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Slide not found' });
    res.json({ message: 'Slide deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listSlides, getSlide, createSlide, updateSlideContent, deleteSlide };
