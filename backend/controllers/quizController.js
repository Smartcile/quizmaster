const db = require('../config/database');
const { generateQuizCode } = require('../utils/codeGenerator');
const { getIo } = require('../sockets');

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
          'media_url', q.media_url, 'points', q.points, 'category', q.category,
          'options', q.options, 'difficulty', q.difficulty,
          'answer_mode', q.answer_mode, 'order', rq."order"
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
    // Return any session that is not yet finished — includes lobby (waiting for teams)
    // and active (quiz in progress). Clients use the returned status to decide how to render.
    const result = await db.query(
      `SELECT * FROM quiz_sessions
       WHERE quiz_id = $1 AND status IN ('lobby', 'active')
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
  // Creates a new session in 'lobby' status. Admin then explicitly begins/stops/restarts it.
  try {
    const { id } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const quizResult = await client.query('SELECT * FROM quizzes WHERE id = $1', [id]);
      if (quizResult.rows.length === 0) throw new Error('Quiz not found');

      // End any prior active sessions for this quiz so /active-session returns the new one
      await client.query(
        "UPDATE quiz_sessions SET status = 'finished' WHERE quiz_id = $1 AND status IN ('lobby', 'active')",
        [id]
      );

      const sessionResult = await client.query(
        "INSERT INTO quiz_sessions (quiz_id, status, current_slide_index) VALUES ($1, 'lobby', 0) RETURNING *",
        [id]
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

async function setSessionStatus(req, res) {
  // Generic transition: lobby | active | finished
  // After updating the DB this handler broadcasts session_status_changed to all
  // clients in the session room — the admin no longer needs to do this via socket.
  try {
    const { sessionId } = req.params;
    const { status } = req.body;
    const valid = ['lobby', 'active', 'finished'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${valid.join(', ')}` });
    }

    const fields = ['status = $1'];
    const params = [status];
    if (status === 'active') {
      params.push(new Date());
      fields.push(`started_at = $${params.length}`);
    }
    params.push(sessionId);

    const result = await db.query(
      `UPDATE quiz_sessions SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    // Authoritative broadcast — DB written first, then push to all clients
    const io = getIo();
    if (io) {
      io.to(`quiz-${sessionId}`).emit('session_status_changed', {
        status,
        currentSlideIndex: result.rows[0].current_slide_index || 0,
        timestamp: new Date().toISOString()
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function restartSession(req, res) {
  // Reset slide index to 0, clear locked rounds, put back in lobby.
  // Teams and answers are preserved.
  try {
    const { sessionId } = req.params;
    const result = await db.query(
      `UPDATE quiz_sessions
       SET status = 'lobby', current_slide_index = 0, started_at = NULL, locked_round_ids = '[]'
       WHERE id = $1 RETURNING *`,
      [sessionId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const io = getIo();
    if (io) {
      io.to(`quiz-${sessionId}`).emit('session_status_changed', {
        status: 'lobby',
        currentSlideIndex: 0,
        timestamp: new Date().toISOString()
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Advance slide via REST (server persists + broadcasts) ────────────────────
// Use this instead of socket.emit('slide_changed') so the DB write is guaranteed
// even if the admin's WebSocket happens to be disconnected.
async function setSessionSlide(req, res) {
  try {
    const { sessionId } = req.params;
    const { slideIndex } = req.body;

    if (typeof slideIndex !== 'number') {
      return res.status(400).json({ error: 'slideIndex must be a number' });
    }

    const result = await db.query(
      'UPDATE quiz_sessions SET current_slide_index = $1 WHERE id = $2 RETURNING *',
      [slideIndex, sessionId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const io = getIo();
    if (io) {
      io.to(`quiz-${sessionId}`).emit('slide_changed', {
        slideIndex,
        timestamp: new Date().toISOString()
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getSession(req, res) {
  try {
    const result = await db.query('SELECT * FROM quiz_sessions WHERE id = $1', [req.params.sessionId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Reorder rounds and widgets within an existing quiz ───────────────────────
// Body: { roundIds: [id, ...], widgetIds: [id, ...] }
// Arrays are the complete ordered lists; positions become the new "order" values.
async function reorderQuiz(req, res) {
  try {
    const { id } = req.params;
    const { roundIds, widgetIds } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (Array.isArray(roundIds)) {
        for (let i = 0; i < roundIds.length; i++) {
          await client.query(
            'UPDATE quiz_rounds SET "order" = $1 WHERE quiz_id = $2 AND round_id = $3',
            [i + 1, id, roundIds[i]]
          );
        }
      }

      if (Array.isArray(widgetIds)) {
        for (let i = 0; i < widgetIds.length; i++) {
          await client.query(
            'UPDATE quiz_widgets SET "order" = $1 WHERE quiz_id = $2 AND id = $3',
            [i + 1, id, widgetIds[i]]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Delete a quiz (blocks if a session is active) ────────────────────────────
async function deleteQuiz(req, res) {
  try {
    const { id } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Prevent deleting a quiz that has a running session
      const sessions = await client.query(
        "SELECT id FROM quiz_sessions WHERE quiz_id = $1 AND status IN ('lobby', 'active')",
        [id]
      );
      if (sessions.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cannot delete a quiz with an active session. End the session first.' });
      }

      await client.query('DELETE FROM quiz_rounds  WHERE quiz_id = $1', [id]);
      await client.query('DELETE FROM quiz_widgets WHERE quiz_id = $1', [id]);
      const result = await client.query('DELETE FROM quizzes WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Quiz not found' });
      }

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Full update: rename + replace rounds + replace widgets ────────────────────
// Body: { name, rounds: [roundId, ...], widgets: [{ type, data }, ...] }
async function updateQuiz(req, res) {
  try {
    const { id } = req.params;
    const { name, rounds, widgets } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const quizResult = await client.query(
        'UPDATE quizzes SET name = $1 WHERE id = $2 RETURNING *',
        [name, id]
      );
      if (quizResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Quiz not found' });
      }

      // Replace round associations
      await client.query('DELETE FROM quiz_rounds WHERE quiz_id = $1', [id]);
      if (Array.isArray(rounds) && rounds.length > 0) {
        for (let i = 0; i < rounds.length; i++) {
          await client.query(
            'INSERT INTO quiz_rounds (quiz_id, round_id, "order") VALUES ($1, $2, $3)',
            [id, rounds[i], i + 1]
          );
        }
      }

      // Replace widget associations
      await client.query('DELETE FROM quiz_widgets WHERE quiz_id = $1', [id]);
      if (Array.isArray(widgets) && widgets.length > 0) {
        for (let i = 0; i < widgets.length; i++) {
          await client.query(
            'INSERT INTO quiz_widgets (quiz_id, type, data, "order") VALUES ($1, $2, $3, $4)',
            [id, widgets[i].type, JSON.stringify(widgets[i].data || {}), i + 1]
          );
        }
      }

      await client.query('COMMIT');
      res.json(quizResult.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
  setSessionStatus,
  setSessionSlide,
  restartSession,
  getSession,
  reorderQuiz,
  deleteQuiz,
  updateQuiz
};
