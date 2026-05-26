const db = require('../config/database');
const { generateQuizCode } = require('../utils/codeGenerator');

async function getAllQuizzes(req, res) {
  try {
    const result = await db.query('SELECT * FROM quizzes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function loadQuizWithRoundsAndWidgets(id) {
  const quizResult = await db.query('SELECT * FROM quizzes WHERE id = $1', [id]);
  if (quizResult.rows.length === 0) return null;

  const roundsResult = await db.query(`
    SELECT r.*,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', q.id, 'text', q.text, 'type', q.type, 'answer', q.answer,
          'media_url', q.media_url, 'points', q.points, 'order', rq."order"
        ) ORDER BY rq."order")
        FROM round_questions rq
        JOIN questions q ON rq.question_id = q.id
        WHERE rq.round_id = r.id),
        '[]'::json
      ) as questions
    FROM quiz_rounds qr
    JOIN rounds r ON qr.round_id = r.id
    WHERE qr.quiz_id = $1
    ORDER BY qr."order"
  `, [id]);

  const widgetsResult = await db.query(
    'SELECT * FROM quiz_widgets WHERE quiz_id = $1 ORDER BY "order"',
    [id]
  );

  const quiz = quizResult.rows[0];
  quiz.rounds = roundsResult.rows;
  quiz.widgets = widgetsResult.rows;
  return quiz;
}

async function getQuiz(req, res) {
  try {
    const quiz = await loadQuizWithRoundsAndWidgets(req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    res.json(quiz);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getQuizByCode(req, res) {
  try {
    const codeResult = await db.query('SELECT id FROM quizzes WHERE code = $1', [req.params.code.toUpperCase()]);
    if (codeResult.rows.length === 0) return res.status(404).json({ error: 'Quiz code not found' });
    const quiz = await loadQuizWithRoundsAndWidgets(codeResult.rows[0].id);
    res.json(quiz);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getActiveSession(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM quiz_sessions WHERE quiz_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No active session for this quiz' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createQuiz(req, res) {
  try {
    const { name, rounds, widgets } = req.body;
    const code = generateQuizCode();

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const quizResult = await client.query(
        'INSERT INTO quizzes (name, code) VALUES ($1, $2) RETURNING *',
        [name, code]
      );
      const quizId = quizResult.rows[0].id;

      if (rounds && rounds.length > 0) {
        for (let i = 0; i < rounds.length; i++) {
          await client.query(
            'INSERT INTO quiz_rounds (quiz_id, round_id, "order") VALUES ($1, $2, $3)',
            [quizId, rounds[i], i + 1]
          );
        }
      }

      if (widgets && widgets.length > 0) {
        for (let i = 0; i < widgets.length; i++) {
          await client.query(
            'INSERT INTO quiz_widgets (quiz_id, type, data, "order") VALUES ($1, $2, $3, $4)',
            [quizId, widgets[i].type, JSON.stringify(widgets[i].data || {}), i + 1]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json(quizResult.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function startQuiz(req, res) {
  try {
    const { id } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const quizResult = await client.query('SELECT * FROM quizzes WHERE id = $1', [id]);
      if (quizResult.rows.length === 0) {
        throw new Error('Quiz not found');
      }

      const sessionResult = await client.query(
        'INSERT INTO quiz_sessions (quiz_id, status) VALUES ($1, $2) RETURNING *',
        [id, 'active']
      );

      await client.query('COMMIT');
      res.status(201).json(sessionResult.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function endQuiz(req, res) {
  try {
    const { sessionId } = req.params;
    const result = await db.query(
      'UPDATE quiz_sessions SET status = $1 WHERE id = $2 RETURNING *',
      ['finished', sessionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllQuizzes,
  getQuiz,
  getQuizByCode,
  getActiveSession,
  createQuiz,
  startQuiz,
  endQuiz
};
