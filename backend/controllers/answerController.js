const db = require('../config/database');
const { getIo } = require('../sockets');

// Normalise an answer for fuzzy matching: trim, lowercase, collapse internal
// whitespace, strip leading "the ". Pub-quiz forgiving but not perfect.
function normalizeAnswer(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '');
}

// Insert score=1 for (teamId, questionId) if (a) the answer matches the
// question's correct answer and (b) no score row exists yet — admin
// overrides are never stomped. Returns the points if a score was applied.
async function maybeAutoMark(client, teamId, questionId, answerText) {
  const existing = await client.query(
    'SELECT id FROM scores WHERE team_id = $1 AND question_id = $2',
    [teamId, questionId]
  );
  if (existing.rows.length > 0) return null;

  const qres = await client.query('SELECT answer FROM questions WHERE id = $1', [questionId]);
  if (!qres.rows.length) return null;

  if (normalizeAnswer(answerText) !== normalizeAnswer(qres.rows[0].answer)) return null;

  const ins = await client.query(
    'INSERT INTO scores (team_id, question_id, points_awarded) VALUES ($1, $2, 1) RETURNING points_awarded',
    [teamId, questionId]
  );
  return parseFloat(ins.rows[0].points_awarded);
}

async function submitAnswer(req, res) {
  try {
    const { teamId, roundId, questionId, answerText, sessionId } = req.body;

    const client = await db.getClient();
    let result;
    let autoMarked = null;
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT id FROM answers WHERE team_id = $1 AND question_id = $2',
        [teamId, questionId]
      );

      if (existing.rows.length > 0) {
        result = await client.query(
          'UPDATE answers SET answer_text = $1 WHERE team_id = $2 AND question_id = $3 RETURNING *',
          [answerText, teamId, questionId]
        );
      } else {
        result = await client.query(
          'INSERT INTO answers (team_id, round_id, question_id, answer_text) VALUES ($1, $2, $3, $4) RETURNING *',
          [teamId, roundId, questionId, answerText]
        );
      }

      autoMarked = await maybeAutoMark(client, teamId, questionId, answerText);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    client.release();

    if (autoMarked != null && sessionId) {
      const io = getIo();
      if (io) {
        io.to(`quiz-${sessionId}`).emit('answer_marked', {
          teamId:     parseInt(teamId),
          questionId: parseInt(questionId),
          points:     autoMarked,
          autoMarked: true,
          timestamp:  new Date().toISOString()
        });
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getAnswersByQuestion(req, res) {
  try {
    const { questionId, sessionId } = req.query;
    const result = await db.query(`
      SELECT a.*, t.name as team_name, q.answer as correct_answer
      FROM answers a
      JOIN teams t ON a.team_id = t.id
      JOIN questions q ON a.question_id = q.id
      WHERE a.question_id = $1 AND t.quiz_session_id = $2
      ORDER BY t.name
    `, [questionId, sessionId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getTeamAnswers(req, res) {
  try {
    const { teamId, roundId } = req.query;
    const result = await db.query(
      'SELECT * FROM answers WHERE team_id = $1 AND round_id = $2 ORDER BY question_id',
      [teamId, roundId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function markAnswer(req, res) {
  try {
    const { teamId, questionId, points, sessionId } = req.body;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT id FROM scores WHERE team_id = $1 AND question_id = $2',
        [teamId, questionId]
      );

      let result;
      if (existing.rows.length > 0) {
        result = await client.query(
          'UPDATE scores SET points_awarded = $1 WHERE team_id = $2 AND question_id = $3 RETURNING *',
          [points, teamId, questionId]
        );
      } else {
        result = await client.query(
          'INSERT INTO scores (team_id, question_id, points_awarded) VALUES ($1, $2, $3) RETURNING *',
          [teamId, questionId, points]
        );
      }

      await client.query('COMMIT');

      // Broadcast so quizzers see their awarded score immediately
      const io = getIo();
      if (io && sessionId) {
        io.to(`quiz-${sessionId}`).emit('answer_marked', {
          teamId:     parseInt(teamId),
          questionId: parseInt(questionId),
          points,
          timestamp: new Date().toISOString()
        });
      }

      res.status(201).json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── getSessionAnswers ────────────────────────────────────────────────────────
// Returns all rounds, questions, teams, answers and scores for a session in one
// call so the marking UI can render without a waterfall of requests.
// Also backfills auto-marks for any (team, question) where the answer matches
// the correct answer and no score row exists yet — keeps legacy data current.
async function getSessionAnswers(req, res) {
  try {
    const { sessionId } = req.params;

    const sessResult = await db.query(
      'SELECT quiz_id FROM quiz_sessions WHERE id = $1',
      [sessionId]
    );
    if (!sessResult.rows.length) return res.status(404).json({ error: 'Session not found' });
    const quizId = sessResult.rows[0].quiz_id;

    // Backfill auto-marks for this session's answers (idempotent, ON CONFLICT-free
    // via NOT EXISTS).
    await db.query(`
      INSERT INTO scores (team_id, question_id, points_awarded)
      SELECT a.team_id, a.question_id, 1
      FROM answers a
      JOIN teams t       ON a.team_id = t.id
      JOIN questions q   ON a.question_id = q.id
      WHERE t.quiz_session_id = $1
        AND a.answer_text IS NOT NULL
        AND LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(a.answer_text), '\\s+', ' ', 'g'), '^the\\s+', ''))
            = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(q.answer),       '\\s+', ' ', 'g'), '^the\\s+', ''))
        AND NOT EXISTS (
          SELECT 1 FROM scores s
          WHERE s.team_id = a.team_id AND s.question_id = a.question_id
        )
    `, [sessionId]);

    const roundsResult = await db.query(`
      SELECT r.id, r.name, qr."order"
      FROM quiz_rounds qr
      JOIN rounds r ON qr.round_id = r.id
      WHERE qr.quiz_id = $1
      ORDER BY qr."order"
    `, [quizId]);

    const roundIds = roundsResult.rows.map(r => r.id);
    const questionsResult = roundIds.length ? await db.query(`
      SELECT q.id, q.text, q.answer, q.points, rq.round_id, rq."order"
      FROM round_questions rq
      JOIN questions q ON rq.question_id = q.id
      WHERE rq.round_id = ANY($1::int[])
      ORDER BY rq.round_id, rq."order"
    `, [roundIds]) : { rows: [] };

    const teamsResult = await db.query(
      'SELECT id, name, size FROM teams WHERE quiz_session_id = $1 ORDER BY name',
      [sessionId]
    );
    const teamIds = teamsResult.rows.map(t => t.id);

    const [answersResult, scoresResult] = teamIds.length
      ? await Promise.all([
          db.query('SELECT team_id, question_id, answer_text FROM answers WHERE team_id = ANY($1::int[])', [teamIds]),
          db.query('SELECT team_id, question_id, points_awarded FROM scores WHERE team_id = ANY($1::int[])', [teamIds])
        ])
      : [{ rows: [] }, { rows: [] }];

    res.json({
      rounds:    roundsResult.rows,
      questions: questionsResult.rows,
      teams:     teamsResult.rows,
      answers:   answersResult.rows,
      scores:    scoresResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── exportAnswersCSV ─────────────────────────────────────────────────────────
// GET /api/answers/export?sessionId=X[&roundId=Y]
// Returns a UTF-8 CSV: Team, Round, Q#, Question, Correct Answer, Team Answer, Points
async function exportAnswersCSV(req, res) {
  try {
    const { sessionId, roundId } = req.query;

    const base = `
      SELECT
        t.name                                   AS "Team",
        r.name                                   AS "Round",
        rq."order"                               AS "Q#",
        q.text                                   AS "Question",
        q.answer                                 AS "Correct Answer",
        COALESCE(a.answer_text, '')              AS "Team Answer",
        COALESCE(s.points_awarded::text, 'unmarked') AS "Points"
      FROM teams t
      JOIN quiz_sessions qs ON t.quiz_session_id = qs.id
      JOIN quiz_rounds qr   ON qr.quiz_id = qs.quiz_id
      JOIN rounds r         ON qr.round_id = r.id
      JOIN round_questions rq ON rq.round_id = r.id
      JOIN questions q      ON rq.question_id = q.id
      LEFT JOIN answers a   ON a.team_id = t.id AND a.question_id = q.id
      LEFT JOIN scores s    ON s.team_id = t.id AND s.question_id = q.id
      WHERE t.quiz_session_id = $1`;

    const [query, params] = roundId
      ? [base + ' AND r.id = $2 ORDER BY t.name, rq."order"',       [sessionId, roundId]]
      : [base + ' ORDER BY t.name, qr."order", rq."order"',          [sessionId]];

    const result = await db.query(query, params);

    if (!result.rows.length) return res.status(404).json({ error: 'No data to export' });

    const headers = Object.keys(result.rows[0]);
    const escape  = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      headers.join(','),
      ...result.rows.map(row => headers.map(h => escape(row[h])).join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="quiz-session-${sessionId}.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function awardBrowniePoints(req, res) {
  try {
    const { teamId, label, points } = req.body;
    const result = await db.query(
      'INSERT INTO brownie_points (team_id, label, points) VALUES ($1, $2, $3) RETURNING *',
      [teamId, label, points]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  submitAnswer,
  getAnswersByQuestion,
  getTeamAnswers,
  markAnswer,
  getSessionAnswers,
  exportAnswersCSV,
  awardBrowniePoints
};
