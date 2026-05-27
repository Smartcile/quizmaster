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

// ── Core loader used by getQuiz, getQuizByCode, and websocket handlers ────────
// Returns quiz with:
//   quiz.items  — unified ordered array of { kind:'round'|'widget', ...fields }
//   quiz.rounds — legacy array of round rows (for backward compat)
//   quiz.widgets — legacy array of widget rows (for backward compat)
async function loadQuizWithRoundsAndWidgets(id) {
  const quizResult = await db.query(
    `SELECT q.*, sm.name AS master_name, sm.templates AS master_templates
     FROM quizzes q
     LEFT JOIN slide_masters sm ON sm.id = q.master_id
     WHERE q.id = $1`,
    [id]
  );
  if (quizResult.rows.length === 0) return null;

  const roundsResult = await db.query(`
    SELECT r.*, qr.position,
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
    ORDER BY COALESCE(qr.position, qr."order")
  `, [id]);

  const widgetsResult = await db.query(
    'SELECT * FROM quiz_widgets WHERE quiz_id = $1 ORDER BY COALESCE(position, "order")',
    [id]
  );

  const quiz = quizResult.rows[0];

  // Build unified items list
  const roundItems  = roundsResult.rows.map(r => ({ kind: 'round',  ...r }));
  const widgetItems = widgetsResult.rows.map(w => ({ kind: 'widget', ...w }));
  const allItems    = [...roundItems, ...widgetItems];

  const hasPositions = allItems.some(i => i.position !== null);
  if (hasPositions) {
    // New interleaved ordering: sort by global position
    quiz.items = allItems.sort((a, b) => (a.position ?? 999999) - (b.position ?? 999999));
  } else {
    // Legacy ordering: all rounds first (in round order), then all widgets
    quiz.items = allItems; // already sorted by individual ORDER BY COALESCE above
  }

  // Keep legacy arrays for any code that still reads quiz.rounds / quiz.widgets
  quiz.rounds  = roundsResult.rows;
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

// ── Shared helper: build ordered list from either new 'items' or legacy payload ─
// Returns [{ kind, roundId?, type?, data? }, ...] with position = array index.
function normaliseOrderList(items, rounds, widgets) {
  if (Array.isArray(items)) return items;
  return [
    ...(Array.isArray(rounds)  ? rounds.map(id => ({ kind: 'round',  roundId: id })) : []),
    ...(Array.isArray(widgets) ? widgets.map(w  => ({ kind: 'widget', ...w }))        : [])
  ];
}

async function createQuiz(req, res) {
  try {
    const { name, items, rounds, widgets, master_id } = req.body;
    const code = generateQuizCode();

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const quizResult = await client.query(
        'INSERT INTO quizzes (name, code, master_id) VALUES ($1, $2, $3) RETURNING *',
        [name, code, master_id || null]
      );
      const quizId = quizResult.rows[0].id;

      const orderList = normaliseOrderList(items, rounds, widgets);
      let roundOrder = 1, widgetOrder = 1;

      for (let i = 0; i < orderList.length; i++) {
        const item = orderList[i];
        if (item.kind === 'round') {
          await client.query(
            'INSERT INTO quiz_rounds (quiz_id, round_id, "order", position) VALUES ($1, $2, $3, $4)',
            [quizId, item.roundId, roundOrder++, i]
          );
        } else if (item.kind === 'widget') {
          await client.query(
            'INSERT INTO quiz_widgets (quiz_id, type, data, "order", position) VALUES ($1, $2, $3, $4, $5)',
            [quizId, item.type, JSON.stringify(item.data || {}), widgetOrder++, i]
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
      if (quizResult.rows.length === 0) throw new Error('Quiz not found');

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

// ── Reorder: unified items OR legacy roundIds/widgetIds ───────────────────────
// New body: { items: [{kind:'round', roundId:...} | {kind:'widget', widgetId:...}] }
// Legacy body: { roundIds: [...], widgetIds: [...] }
async function reorderQuiz(req, res) {
  try {
    const { id } = req.params;
    const { items, roundIds, widgetIds } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (Array.isArray(items)) {
        // New unified format: update position on each row
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'round') {
            await client.query(
              'UPDATE quiz_rounds SET position = $1 WHERE quiz_id = $2 AND round_id = $3',
              [i, id, item.roundId]
            );
          } else if (item.kind === 'widget') {
            await client.query(
              'UPDATE quiz_widgets SET position = $1 WHERE quiz_id = $2 AND id = $3',
              [i, id, item.widgetId]
            );
          }
        }
      } else {
        // Legacy format: update per-table "order" column only
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

async function deleteQuiz(req, res) {
  try {
    const { id } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

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

// ── Full update: rename + replace all items ───────────────────────────────────
// Body: { name, items: [{kind, roundId?, type?, data?}, ...], master_id }
//   OR legacy: { name, rounds: [roundId,...], widgets: [{type,data},...], master_id }
async function updateQuiz(req, res) {
  try {
    const { id } = req.params;
    const { name, items, rounds, widgets, master_id } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const quizResult = await client.query(
        'UPDATE quizzes SET name = $1, master_id = $2 WHERE id = $3 RETURNING *',
        [name, master_id || null, id]
      );
      if (quizResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Quiz not found' });
      }

      // Delete all existing associations, then re-insert in the new order
      await client.query('DELETE FROM quiz_rounds  WHERE quiz_id = $1', [id]);
      await client.query('DELETE FROM quiz_widgets WHERE quiz_id = $1', [id]);

      const orderList = normaliseOrderList(items, rounds, widgets);
      let roundOrder = 1, widgetOrder = 1;

      for (let i = 0; i < orderList.length; i++) {
        const item = orderList[i];
        if (item.kind === 'round') {
          await client.query(
            'INSERT INTO quiz_rounds (quiz_id, round_id, "order", position) VALUES ($1, $2, $3, $4)',
            [id, item.roundId, roundOrder++, i]
          );
        } else if (item.kind === 'widget') {
          await client.query(
            'INSERT INTO quiz_widgets (quiz_id, type, data, "order", position) VALUES ($1, $2, $3, $4, $5)',
            [id, item.type, JSON.stringify(item.data || {}), widgetOrder++, i]
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
  updateQuiz,
  loadQuizWithRoundsAndWidgets
};
