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
     LEFT JOIN slide_masters sm
       ON sm.id = COALESCE(q.master_id, (SELECT id FROM slide_masters WHERE is_default = TRUE LIMIT 1))
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
          'answer_mode', CASE rq.question_format_override
            WHEN 'standard'    THEN 'text'
            WHEN 'multichoice' THEN 'mcq'
            WHEN 'both'        THEN 'both'
            ELSE q.answer_mode END,
          'audio_form', CASE
            WHEN q.audio_form = 'both' THEN COALESCE(rq.audio_form_override, 'name_the_song')
            ELSE q.audio_form END,
          'audio_stop_seconds', q.audio_stop_seconds,
          'lyrics', q.lyrics,
          'answer_reveal_seconds', q.answer_reveal_seconds,
          'media_artist', mf.artist,
          'media_title', mf.title,
          'order', rq."order"
        ) ORDER BY rq."order")
        FROM round_questions rq
        JOIN questions q ON rq.question_id = q.id
        LEFT JOIN media_files mf ON mf.url = q.media_url
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

  // Resolve a referenced Who/What Am I set. The quiz_widgets row stores only
  // { whoamiId }; buildSlides + the lock flow need the title/answer/clues, so we
  // hydrate them from the source question here. Legacy inline configs (data that
  // already carries clues) are left as-is.
  const whoamiItem = quiz.items.find(i => i.kind === 'widget' && i.type === 'whoami');
  if (whoamiItem) {
    let d = whoamiItem.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
    if (d && d.whoamiId && !(Array.isArray(d.clues) && d.clues.length)) {
      const wq = await db.query(
        'SELECT text, answer, options FROM questions WHERE id = $1',
        [d.whoamiId]
      );
      if (wq.rows.length) {
        const opts = wq.rows[0].options;
        d = {
          whoamiId: d.whoamiId,
          title:  wq.rows[0].text || 'Who Am I?',
          answer: wq.rows[0].answer || '',
          clues:  Array.isArray(opts) ? opts : []
        };
      }
    }
    whoamiItem.data = d;
    const wRow = quiz.widgets.find(w => w.type === 'whoami');
    if (wRow) wRow.data = d;
  }

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
    // Test sessions are excluded so a running test never shows as "LIVE" on the
    // dashboard. Test iframes target their session by explicit id instead.
    const result = await db.query(
      `SELECT * FROM quiz_sessions
       WHERE quiz_id = $1 AND status IN ('lobby', 'active') AND is_test = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No active session for this quiz' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Resolve a join code → { quiz, session } ───────────────────────────────────
// GET /api/quizzes/resolve/:code
// Tries a per-session code first (exact session, any status — so old/finished
// codes resolve for history lookup). Falls back to the quiz code → that quiz's
// current live (lobby/active, non-test) session, or null if none is running.
async function resolveCode(req, res) {
  try {
    const code = String(req.params.code || '').toUpperCase();
    if (!code) return res.status(400).json({ error: 'code required' });

    // 1) Session code (most recent if somehow duplicated)
    const bySession = await db.query(
      'SELECT * FROM quiz_sessions WHERE UPPER(code) = $1 ORDER BY created_at DESC LIMIT 1',
      [code]
    );
    if (bySession.rows.length) {
      const session = bySession.rows[0];
      const quiz = await loadQuizWithRoundsAndWidgets(session.quiz_id);
      return res.json({ quiz, session });
    }

    // 2) Quiz code → current live session (if any)
    const quizRow = await db.query('SELECT id FROM quizzes WHERE code = $1', [code]);
    if (!quizRow.rows.length) return res.status(404).json({ error: 'Code not found' });
    const quiz = await loadQuizWithRoundsAndWidgets(quizRow.rows[0].id);
    const active = await db.query(
      `SELECT * FROM quiz_sessions
       WHERE quiz_id = $1 AND status IN ('lobby', 'active') AND is_test = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [quizRow.rows[0].id]
    );
    return res.json({ quiz, session: active.rows[0] || null });
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
    const { name, items, rounds, widgets, master_id, team_size_scoring } = req.body;
    const code = generateQuizCode();

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const quizResult = await client.query(
        'INSERT INTO quizzes (name, code, master_id, team_size_scoring) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, code, master_id || null, team_size_scoring || false]
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

// Generate a session join code that isn't already in use.
async function uniqueSessionCode(client) {
  for (let i = 0; i < 25; i++) {
    const code = generateQuizCode();
    const r = await client.query('SELECT 1 FROM quiz_sessions WHERE code = $1', [code]);
    if (!r.rows.length) return code;
  }
  return generateQuizCode();
}

async function startQuiz(req, res) {
  try {
    const { id } = req.params;
    const isTest = req.body?.isTest === true;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const quizResult = await client.query('SELECT * FROM quizzes WHERE id = $1', [id]);
      if (quizResult.rows.length === 0) throw new Error('Quiz not found');

      // Close any existing live session for this quiz. Test sessions are left
      // alone so a test run never disturbs (or is disturbed by) a live one.
      await client.query(
        "UPDATE quiz_sessions SET status = 'finished' WHERE quiz_id = $1 AND status IN ('lobby', 'active') AND is_test = FALSE",
        [id]
      );

      const sessionCode = await uniqueSessionCode(client);
      const sessionResult = await client.query(
        "INSERT INTO quiz_sessions (quiz_id, status, current_slide_index, is_test, code) VALUES ($1, 'lobby', 0, $2, $3) RETURNING *",
        [id, isTest, sessionCode]
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

// ── Scoreboard visibility ─────────────────────────────────────────────────────
// PUT /api/quizzes/sessions/:sessionId/scoreboard-visibility
// Body: { surface: 'slideshow'|'quizzer'|'admin', visible: bool }  (toggle one)
//   OR: { visibility: { slideshow, quizzer, admin } }              (set all)
// Persists the flags and broadcasts scoreboard_visibility_changed to the room
// so every surface shows/hides its live scoreboard in real time.
async function setScoreboardVisibility(req, res) {
  try {
    const { sessionId } = req.params;
    const { surface, visible, visibility } = req.body;
    const VALID = ['slideshow', 'quizzer', 'admin'];

    const cur = await db.query('SELECT scoreboard_visibility FROM quiz_sessions WHERE id = $1', [sessionId]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const next = { slideshow: true, quizzer: true, admin: false, ...(cur.rows[0].scoreboard_visibility || {}) };
    if (visibility && typeof visibility === 'object') {
      VALID.forEach(k => { if (k in visibility) next[k] = !!visibility[k]; });
    } else if (VALID.includes(surface)) {
      next[surface] = !!visible;
    } else {
      return res.status(400).json({ error: 'surface must be one of slideshow, quizzer, admin' });
    }

    const result = await db.query(
      'UPDATE quiz_sessions SET scoreboard_visibility = $1 WHERE id = $2 RETURNING *',
      [JSON.stringify(next), sessionId]
    );

    const io = getIo();
    if (io) {
      io.to(`quiz-${sessionId}`).emit('scoreboard_visibility_changed', {
        visibility: next,
        timestamp: new Date().toISOString()
      });
    }

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
    const { name, items, rounds, widgets, master_id, team_size_scoring } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const quizResult = await client.query(
        'UPDATE quizzes SET name = $1, master_id = $2, team_size_scoring = $3 WHERE id = $4 RETURNING *',
        [name, master_id || null, team_size_scoring || false, id]
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

// ── Session history: all finished sessions with quiz info + team count ────────
async function getSessionHistory(req, res) {
  try {
    const result = await db.query(`
      SELECT
        qs.id           AS session_id,
        qs.created_at,
        qs.started_at,
        q.id            AS quiz_id,
        q.name          AS quiz_name,
        q.code          AS quiz_code,
        COUNT(DISTINCT t.id)::int AS team_count
      FROM quiz_sessions qs
      JOIN quizzes q        ON qs.quiz_id = q.id
      LEFT JOIN teams t     ON t.quiz_session_id = qs.id
      WHERE qs.status = 'finished' AND qs.is_test = FALSE
      GROUP BY qs.id, q.id, q.name, q.code
      ORDER BY qs.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Session results: teams with total scores for a finished session ───────────
async function getSessionResults(req, res) {
  try {
    const { sessionId } = req.params;
    const teamsResult = await db.query(`
      SELECT
        t.id,
        t.name,
        t.size,
        COALESCE(SUM(s.points_awarded), 0)::float AS score_total,
        COALESCE(
          (SELECT SUM(bp.points) FROM brownie_points bp WHERE bp.team_id = t.id),
          0
        )::float AS brownie_total,
        COALESCE(
          (SELECT g.points_awarded FROM whoami_guesses g WHERE g.team_id = t.id),
          0
        )::float AS whoami_points,
        CASE WHEN q.team_size_scoring
          THEN GREATEST(-4, LEAST(5, 6 - COALESCE(t.size, 6)))
          ELSE 0
        END::float AS size_points
      FROM teams t
      JOIN quiz_sessions qs ON qs.id = t.quiz_session_id
      JOIN quizzes q ON q.id = qs.quiz_id
      LEFT JOIN scores s ON s.team_id = t.id
      WHERE t.quiz_session_id = $1
      GROUP BY t.id, t.name, t.size, q.team_size_scoring
      ORDER BY
        (
          COALESCE(SUM(s.points_awarded), 0) +
          COALESCE((SELECT SUM(bp.points) FROM brownie_points bp WHERE bp.team_id = t.id), 0) +
          COALESCE((SELECT g.points_awarded FROM whoami_guesses g WHERE g.team_id = t.id), 0) +
          CASE WHEN q.team_size_scoring
            THEN GREATEST(-4, LEAST(5, 6 - COALESCE(t.size, 6)))
            ELSE 0
          END
        ) DESC,
        t.name ASC
    `, [sessionId]);
    res.json({ teams: teamsResult.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Delete a finished session and all its data (teams/answers/scores cascade) ──
// List running test sessions (lobby/active, is_test) so the dashboard can show
// and clean them — they're deliberately excluded from the normal active-session
// lookup, so without this they'd be invisible if auto-clean didn't fire.
async function getActiveTestSessions(req, res) {
  try {
    const result = await db.query(
      `SELECT s.id, s.quiz_id, s.code, s.status, s.current_slide_index, s.created_at,
              q.name AS quiz_name, q.code AS quiz_code
       FROM quiz_sessions s
       JOIN quizzes q ON q.id = s.quiz_id
       WHERE s.is_test = TRUE AND s.status IN ('lobby', 'active')
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Bulk-delete every test session (any status). Cascades teams/answers/scores.
// Never touches real sessions.
async function deleteAllTestSessions(req, res) {
  try {
    const result = await db.query('DELETE FROM quiz_sessions WHERE is_test = TRUE RETURNING id');
    res.json({ ok: true, deleted: result.rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteSession(req, res) {
  try {
    const { sessionId } = req.params;
    const check = await db.query('SELECT status, is_test FROM quiz_sessions WHERE id = $1', [sessionId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    // Test sessions can be removed at any time (auto-clean on close). Real
    // sessions must be finished first, to protect live results.
    if (!check.rows[0].is_test && check.rows[0].status !== 'finished') {
      return res.status(409).json({ error: 'Only finished sessions can be deleted. End the session first.' });
    }
    // FK cascades from quiz_sessions → teams → answers/scores/brownie_points
    await db.query('DELETE FROM quiz_sessions WHERE id = $1', [sessionId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllQuizzes,
  getQuiz,
  getQuizByCode,
  getActiveSession,
  resolveCode,
  createQuiz,
  startQuiz,
  setSessionStatus,
  setSessionSlide,
  restartSession,
  getSession,
  reorderQuiz,
  deleteQuiz,
  updateQuiz,
  loadQuizWithRoundsAndWidgets,
  getSessionHistory,
  getSessionResults,
  getActiveTestSessions,
  deleteAllTestSessions,
  deleteSession,
  setScoreboardVisibility
};
