const db = require('../config/database');

async function getAllQuestions(req, res) {
  try {
    const result = await db.query('SELECT * FROM questions ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getQuestion(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM questions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createQuestion(req, res) {
  try {
    const { text, answer, type, media_url, points, tags } = req.body;
    const result = await db.query(
      'INSERT INTO questions (text, answer, type, media_url, points, tags) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [text, answer, type, media_url, points, tags]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateQuestion(req, res) {
  try {
    const { id } = req.params;
    const { text, answer, type, media_url, points, tags } = req.body;
    const result = await db.query(
      'UPDATE questions SET text = $1, answer = $2, type = $3, media_url = $4, points = $5, tags = $6 WHERE id = $7 RETURNING *',
      [text, answer, type, media_url, points, tags, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteQuestion(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM questions WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json({ message: 'Question deleted', id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion
};
