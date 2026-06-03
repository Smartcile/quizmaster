const db = require('../config/database');
const { getIo } = require('../sockets');

// ── Who Am I? ────────────────────────────────────────────────────────────────
// A quiz may carry a single "Who Am I?" element, stored as a quiz_widgets row
// of type 'whoami' with data = { title, answer, clues: [{ text, points }] }.
// One clue is revealed before each round; teams lock in a single guess and earn
// the point value of the latest clue revealed at lock-in. The shared answer is
// revealed on the End slide. Per-team lock-in lives in the whoami_guesses table.

function normalizeAnswer(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '');
}

// Resolve a session → its quiz's Who-Am-I config (or null if it has none).
async function loadWhoamiForSession(sessionId) {
  const r = await db.query(
    `SELECT w.id, w.data
     FROM quiz_sessions qs
     JOIN quiz_widgets w ON w.quiz_id = qs.quiz_id AND w.type = 'whoami'
     WHERE qs.id = $1
     ORDER BY w.id
     LIMIT 1`,
    [sessionId]
  );
  if (!r.rows.length) return null;
  let data = typeof r.rows[0].data === 'string'
    ? (() => { try { return JSON.parse(r.rows[0].data); } catch { return {}; } })()
    : (r.rows[0].data || {});

  // The widget may only reference a Who/What Am I set authored in the Question
  // Builder (data = { whoamiId }). Hydrate the title/answer/clues from it unless
  // the widget already carries an inline config (legacy quizzes).
  if (data.whoamiId && !(Array.isArray(data.clues) && data.clues.length)) {
    const q = await db.query('SELECT text, answer, options FROM questions WHERE id = $1', [data.whoamiId]);
    if (q.rows.length) {
      data = {
        whoamiId: data.whoamiId,
        title:  q.rows[0].text || 'Who Am I?',
        answer: q.rows[0].answer || '',
        clues:  Array.isArray(q.rows[0].options) ? q.rows[0].options : []
      };
    }
  }

  return {
    widgetId: r.rows[0].id,
    title:    data.title || 'Who Am I?',
    answer:   data.answer || '',
    clues:    Array.isArray(data.clues) ? data.clues : []
  };
}

// GET /api/whoami/session/:sessionId
// Returns the config (clues + answer) and every team's lock-in row. Used by the
// admin marking page, the scoreboard, and quizzer reconnect-state restore.
async function getSessionWhoami(req, res) {
  try {
    const { sessionId } = req.params;
    const cfg = await loadWhoamiForSession(sessionId);
    if (!cfg) return res.json({ whoami: null, guesses: [] });

    const guesses = await db.query(
      `SELECT g.team_id, g.guess_text, g.locked_clue_index,
              g.points_possible::float AS points_possible,
              g.points_awarded::float  AS points_awarded,
              g.auto_marked, g.locked
       FROM whoami_guesses g
       JOIN teams t ON t.id = g.team_id
       WHERE t.quiz_session_id = $1`,
      [sessionId]
    );

    res.json({
      whoami: { title: cfg.title, answer: cfg.answer, clues: cfg.clues },
      guesses: guesses.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// POST /api/whoami/lock
// Body: { sessionId, teamId, clueIndex, guess }
// Locks a team's guess. Points come from the server-side clue config (the
// client only says which clue was showing). Auto-marks: correct → clue points,
// wrong → 0. Once a row is locked it cannot be changed here.
async function lockGuess(req, res) {
  try {
    const { sessionId, teamId, clueIndex, guess } = req.body;
    if (!sessionId || !teamId) {
      return res.status(400).json({ error: 'sessionId and teamId are required' });
    }

    const cfg = await loadWhoamiForSession(sessionId);
    if (!cfg) return res.status(404).json({ error: 'This quiz has no Who Am I?' });

    // Already locked → return existing, no change (lock is immutable)
    const existing = await db.query('SELECT * FROM whoami_guesses WHERE team_id = $1', [teamId]);
    if (existing.rows.length && existing.rows[0].locked) {
      const row = existing.rows[0];
      return res.json({
        teamId: parseInt(teamId),
        guess_text: row.guess_text,
        locked_clue_index: row.locked_clue_index,
        points_possible: parseFloat(row.points_possible),
        points_awarded: row.points_awarded == null ? null : parseFloat(row.points_awarded),
        locked: true,
        alreadyLocked: true
      });
    }

    // Clamp clue index into the configured range
    const maxIdx = Math.max(0, cfg.clues.length - 1);
    const idx = Math.min(Math.max(parseInt(clueIndex) || 0, 0), maxIdx);
    const pointsPossible = parseFloat(cfg.clues[idx]?.points) || 0;
    const isCorrect = normalizeAnswer(guess) === normalizeAnswer(cfg.answer);
    const pointsAwarded = isCorrect ? pointsPossible : 0;

    const upsert = await db.query(
      `INSERT INTO whoami_guesses
         (team_id, guess_text, locked_clue_index, points_possible, points_awarded, auto_marked, locked, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, true, NOW())
       ON CONFLICT (team_id) DO UPDATE
         SET guess_text = EXCLUDED.guess_text,
             locked_clue_index = EXCLUDED.locked_clue_index,
             points_possible = EXCLUDED.points_possible,
             points_awarded = EXCLUDED.points_awarded,
             auto_marked = true,
             locked = true,
             updated_at = NOW()
       RETURNING *`,
      [teamId, guess ?? '', idx, pointsPossible, pointsAwarded]
    );
    const row = upsert.rows[0];

    const io = getIo();
    if (io) {
      io.to(`quiz-${sessionId}`).emit('whoami_locked', {
        teamId: parseInt(teamId),
        lockedClueIndex: idx,
        timestamp: new Date().toISOString()
      });
      io.to(`quiz-${sessionId}`).emit('whoami_marked', {
        teamId: parseInt(teamId),
        points: pointsAwarded,
        autoMarked: true,
        timestamp: new Date().toISOString()
      });
    }

    res.status(201).json({
      teamId: parseInt(teamId),
      guess_text: row.guess_text,
      locked_clue_index: row.locked_clue_index,
      points_possible: parseFloat(row.points_possible),
      points_awarded: parseFloat(row.points_awarded),
      locked: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// POST /api/whoami/mark
// Body: { sessionId, teamId, points }   (points number → override, null → clear)
// Admin manual override at the Mark Answers page. Sets auto_marked = false.
async function markGuess(req, res) {
  try {
    const { sessionId, teamId, points } = req.body;
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });

    const clear = points === null || points === undefined;

    const existing = await db.query('SELECT id FROM whoami_guesses WHERE team_id = $1', [teamId]);
    if (existing.rows.length) {
      await db.query(
        `UPDATE whoami_guesses
         SET points_awarded = $1, auto_marked = false, updated_at = NOW()
         WHERE team_id = $2`,
        [clear ? null : points, teamId]
      );
    } else {
      await db.query(
        `INSERT INTO whoami_guesses
           (team_id, points_awarded, auto_marked, locked, updated_at)
         VALUES ($1, $2, false, true, NOW())`,
        [teamId, clear ? null : points]
      );
    }

    const io = getIo();
    if (io && sessionId) {
      io.to(`quiz-${sessionId}`).emit('whoami_marked', {
        teamId: parseInt(teamId),
        points: clear ? null : points,
        timestamp: new Date().toISOString()
      });
    }

    res.status(201).json({ ok: true, points: clear ? null : points });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getSessionWhoami, lockGuess, markGuess, loadWhoamiForSession };
