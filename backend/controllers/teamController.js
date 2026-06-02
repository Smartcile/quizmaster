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
// Returns the full quiz structure broken down per round so every surface can
// render columns: Team | [Starting] | Round 1 | … | Round N | [Bonus] | Total.
//
//   {
//     teamSizeScoring: bool,
//     hasBrownie: bool,
//     rounds: [{ id, name, format }],          // in quiz order
//     teams:  [{
//       id, name, size, size_points, brownie_total,
//       round_scores: { [roundId]: number },   // points earned in each round
//       round_total, total
//     }]                                        // sorted by total desc
//   }
//
// `total` = size_points + brownie_total + Σ(round_scores). Computing the total
// from the round columns guarantees the displayed columns always add up.
async function getSessionScoreboard(req, res) {
  try {
    const { sessionId } = req.params;

    // 1) Resolve the session's quiz + whether handicap scoring is on
    const sessRes = await db.query(
      `SELECT qs.quiz_id, q.team_size_scoring
       FROM quiz_sessions qs JOIN quizzes q ON q.id = qs.quiz_id
       WHERE qs.id = $1`,
      [sessionId]
    );
    if (!sessRes.rows.length) return res.status(404).json({ error: 'Session not found' });
    const { quiz_id, team_size_scoring } = sessRes.rows[0];

    // 2) Rounds of the quiz, in their on-screen order (interleaved position first)
    const roundsRes = await db.query(
      `SELECT r.id, r.name, r.format
       FROM quiz_rounds qr JOIN rounds r ON r.id = qr.round_id
       WHERE qr.quiz_id = $1
       ORDER BY COALESCE(qr.position, qr."order"), r.name`,
      [quiz_id]
    );
    const rounds = roundsRes.rows;

    // 3) Base team rows: handicap (size_points) + brownie totals
    const teamsRes = await db.query(`
      SELECT
        t.id, t.name, t.size,
        CASE WHEN $2::boolean THEN GREATEST(-4, LEAST(5, 6 - COALESCE(t.size, 6))) ELSE 0 END::float AS size_points,
        COALESCE(b.brownie_total, 0)::float AS brownie_total
      FROM teams t
      LEFT JOIN (
        SELECT team_id, SUM(points) AS brownie_total FROM brownie_points GROUP BY team_id
      ) b ON b.team_id = t.id
      WHERE t.quiz_session_id = $1
    `, [sessionId, team_size_scoring]);

    // 4) Per team / per round score totals. A round's questions come from
    //    round_questions; scores are matched per question within that round.
    const breakdownRes = await db.query(`
      SELECT t.id AS team_id, qr.round_id, COALESCE(SUM(s.points_awarded), 0)::float AS pts
      FROM teams t
      JOIN quiz_sessions qs ON qs.id = t.quiz_session_id
      JOIN quiz_rounds qr ON qr.quiz_id = qs.quiz_id
      LEFT JOIN round_questions rq ON rq.round_id = qr.round_id
      LEFT JOIN scores s ON s.team_id = t.id AND s.question_id = rq.question_id
      WHERE t.quiz_session_id = $1
      GROUP BY t.id, qr.round_id
    `, [sessionId]);

    // Index the breakdown: { [teamId]: { [roundId]: pts } }
    const byTeam = new Map();
    for (const row of breakdownRes.rows) {
      if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, {});
      byTeam.get(row.team_id)[row.round_id] = Number(row.pts);
    }

    // 5) Who Am I? points (one row per team, if the quiz has a Who-Am-I)
    const whoamiRes = await db.query(`
      SELECT g.team_id, COALESCE(g.points_awarded, 0)::float AS pts
      FROM whoami_guesses g
      JOIN teams t ON t.id = g.team_id
      WHERE t.quiz_session_id = $1
    `, [sessionId]);
    const whoamiByTeam = new Map(whoamiRes.rows.map(r => [r.team_id, Number(r.pts)]));
    const hasWhoami = await db.query(
      `SELECT 1 FROM quiz_widgets WHERE quiz_id = $1 AND type = 'whoami' LIMIT 1`,
      [quiz_id]
    );

    const teams = teamsRes.rows.map(t => {
      const round_scores = byTeam.get(t.id) || {};
      const round_total = rounds.reduce((sum, r) => sum + (round_scores[r.id] || 0), 0);
      const whoami_points = whoamiByTeam.get(t.id) || 0;
      const total = round_total + t.size_points + t.brownie_total + whoami_points;
      return { ...t, round_scores, round_total, whoami_points, total };
    });

    teams.sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));

    res.json({
      teamSizeScoring: !!team_size_scoring,
      hasBrownie: teams.some(t => t.brownie_total !== 0),
      hasWhoami: hasWhoami.rows.length > 0,
      rounds,
      teams
    });
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
