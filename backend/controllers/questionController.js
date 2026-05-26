const db = require('../config/database');

async function getAllQuestions(req, res) {
  try {
    const { category, search } = req.query;
    const conditions = [];
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(text ILIKE $${params.length} OR answer ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT * FROM questions ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getCategories(req, res) {
  try {
    const result = await db.query(
      `SELECT DISTINCT category FROM questions WHERE category IS NOT NULL AND category <> '' ORDER BY category`
    );
    res.json(result.rows.map(r => r.category));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getQuestion(req, res) {
  try {
    const result = await db.query('SELECT * FROM questions WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createQuestion(req, res) {
  try {
    const { text, answer, type, media_url, points, tags, category, options } = req.body;
    const result = await db.query(
      `INSERT INTO questions (text, answer, type, media_url, points, tags, category, options)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [text, answer, type, media_url, points, tags, category, JSON.stringify(options || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateQuestion(req, res) {
  try {
    const { text, answer, type, media_url, points, tags, category, options } = req.body;
    const result = await db.query(
      `UPDATE questions SET text=$1, answer=$2, type=$3, media_url=$4, points=$5,
       tags=$6, category=$7, options=$8 WHERE id=$9 RETURNING *`,
      [text, answer, type, media_url, points, tags, category, JSON.stringify(options || []), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteQuestion(req, res) {
  try {
    const result = await db.query('DELETE FROM questions WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question deleted', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllQuestions,
  getCategories,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion
};
