const db = require('../config/database');

// Find-or-create: if a team with the same name (case-insensitive, trimmed)
// already exists in this session, return that team so the guest can rejoin
// after losing their connection. Only sessions in lobby/active accept joins —
// finished sessions reject so stale codes don't create ghost teams.
async function joinQuiz(req, res) {
  try {
    const { sessionId, name, size } = req.body;
    if (!sessionId || !name || !String(name).trim()) {
      return res.status(400).json({ error: 'sessionId and name are required' });
    }
    const cleanName = String(name).trim();

    // Reject joins into a finished session — they'd never see any slides.
    const sess = await db.query('SELECT status FROM quiz_sessions WHERE id = $1', [sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });
    if (sess.rows[0].status === 'finished') {
      return res.status(409).json({ error: 'This quiz session has finished. Ask the host for a new code.' });
    }

    // Look for an existing team with the same name (case-insensitive)
    const existing = await db.query(
      `SELECT * FROM teams
       WHERE quiz_session_id = $1 AND LOWER(TRIM(name)) = LOWER($2)
       LIMIT 1`,
      [sessionId, cleanName]
    );

    if (existing.rows.length) {
      // Rejoin — return the existing team. Don't overwrite the original size
      // unless the client explicitly sent a new value.
      const team = existing.rows[0];
      if (size != null && Number(size) > 0 && Number(size) !== team.size) {
        const upd = await db.query(
          'UPDATE teams SET size = $1 WHERE id = $2 RETURNING *',
          [size, team.id]
        );
        return res.status(200).json({ ...upd.rows[0], rejoined: true });
      }
      return res.status(200).json({ ...team, rejoined: true });
    }

    const result = await db.query(
      'INSERT INTO teams (quiz_session_id, name, size) VALUES ($1, $2, $3) RETURNING *',
      [sessionId, cleanName, size]
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

// ── getSessionScoreboard ──────────────────────────────────────────────────
// GET /api/teams/session/:sessionId/scoreboard
// Returns all teams in the session with their summed score, ordered high→low.
//   [{ id, name, size, score_total, brownie_total, total }]
// `total` = score_total + brownie_total. The slideshow scoreboard widget
// renders this directly.
async function getSessionScoreboard(req, res) {
  try {
    const { sessionId } = req.params;
    const result = await db.query(`
      SELECT
        t.id,
        t.name,
        t.size,
        COALESCE(s.score_total,   0)::float AS score_total,
        COALESCE(b.brownie_total, 0)::float AS brownie_total,
        (COALESCE(s.score_total, 0) + COALESCE(b.brownie_total, 0))::float AS total
      FROM teams t
      LEFT JOIN (
        SELECT team_id, SUM(points_awarded) AS score_total
        FROM scores GROUP BY team_id
      ) s ON s.team_id = t.id
      LEFT JOIN (
        SELECT team_id, SUM(points) AS brownie_total
        FROM brownie_points GROUP BY team_id
      ) b ON b.team_id = t.id
      WHERE t.quiz_session_id = $1
      ORDER BY total DESC, t.name ASC
    `, [sessionId]);
    res.json(result.rows);
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
  getTeamById,
  getSessionScoreboard
};
