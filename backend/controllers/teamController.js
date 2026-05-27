const db = require('../config/database');

async function joinQuiz(req, res) {
  try {
    const { sessionId, name, size } = req.body;
    const result = await db.query(
      'INSERT INTO teams (quiz_session_id, name, size) VALUES ($1, $2, $3) RETURNING *',
      [sessionId, name, size]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getTeamsBySession(req, res) {
  try {
    const { sessionId } = req.params;
    const result = await db.query(
      'SELECT * FROM teams WHERE quiz_session_id = $1 ORDER BY created_at',
      [sessionId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getTeamScores(req, res) {
  try {
    const { teamId } = req.params;
    const result = await db.query(`
      SELECT t.id, t.name, t.size,
        COALESCE(SUM(s.points_awarded), 0) as total_score,
        json_agg(json_build_object('question_id', s.question_id, 'points', s.points_awarded)) as scores
      FROM teams t
      LEFT JOIN scores s ON t.id = s.team_id
      WHERE t.id = $1
      GROUP BY t.id, t.name, t.size
    `, [teamId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Look up a single team by ID — used by the quizzer to restore identity after a page refresh
async function getTeamById(req, res) {
  try {
    const result = await db.query('SELECT * FROM teams WHERE id = $1', [req.params.teamId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  joinQuiz,
  getTeamsBySession,
  getTeamScores,
  getTeamById
};
