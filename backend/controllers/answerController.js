const db = require('../config/database');

async function submitAnswer(req, res) {
  try {
    const { teamId, roundId, questionId, answerText } = req.body;

    const existing = await db.query(
      'SELECT id FROM answers WHERE team_id = $1 AND question_id = $2',
      [teamId, questionId]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await db.query(
        'UPDATE answers SET answer_text = $1 WHERE team_id = $2 AND question_id = $3 RETURNING *',
        [answerText, teamId, questionId]
      );
    } else {
      result = await db.query(
        'INSERT INTO answers (team_id, round_id, question_id, answer_text) VALUES ($1, $2, $3, $4) RETURNING *',
        [teamId, roundId, questionId, answerText]
      );
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
    const { teamId, questionId, points } = req.body;
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
      res.status(201).json(result.rows[0]);
    } finally {
      client.release();
    }
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
  awardBrowniePoints
};
