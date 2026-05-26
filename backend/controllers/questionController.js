const db = require('../config/database');

const QUESTION_FIELDS = 'text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode';

async function getAllQuestions(req, res) {
  try {
    const { category, search, difficulty } = req.query;
    const conditions = [];
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (difficulty && difficulty !== 'all') {
      params.push(difficulty);
      conditions.push(`difficulty = $${params.length}`);
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

async function getStats(req, res) {
  try {
    const [questions, rounds, quizzes, sessions, byDifficulty, byCategory] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS count FROM questions'),
      db.query('SELECT COUNT(*)::int AS count FROM rounds'),
      db.query('SELECT COUNT(*)::int AS count FROM quizzes'),
      db.query("SELECT COUNT(*)::int AS count FROM quiz_sessions WHERE status IN ('lobby', 'active')"),
      db.query("SELECT COALESCE(difficulty, 'medium') AS difficulty, COUNT(*)::int AS count FROM questions GROUP BY difficulty"),
      db.query("SELECT COALESCE(category, '(uncategorized)') AS category, COUNT(*)::int AS count FROM questions GROUP BY category ORDER BY count DESC LIMIT 10")
    ]);

    res.json({
      questions: questions.rows[0].count,
      rounds: rounds.rows[0].count,
      quizzes: quizzes.rows[0].count,
      activeSessions: sessions.rows[0].count,
      byDifficulty: byDifficulty.rows,
      byCategory: byCategory.rows
    });
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
    const { text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode } = req.body;
    const result = await db.query(
      `INSERT INTO questions (${QUESTION_FIELDS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [text, answer, type || 'text', media_url, points, tags, category,
       JSON.stringify(options || []), difficulty || 'medium', answer_mode || 'text']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateQuestion(req, res) {
  try {
    const { text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode } = req.body;
    const result = await db.query(
      `UPDATE questions SET text=$1, answer=$2, type=$3, media_url=$4, points=$5,
       tags=$6, category=$7, options=$8, difficulty=$9, answer_mode=$10
       WHERE id=$11 RETURNING *`,
      [text, answer, type || 'text', media_url, points, tags, category,
       JSON.stringify(options || []), difficulty || 'medium', answer_mode || 'text',
       req.params.id]
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
  getStats,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion
};
