const db = require('../config/database');
const { getIo } = require('../sockets');

// ── Double Up (per-team joker) ────────────────────────────────────────────────
// Each team picks ONE round to score ×2, on the quizzer's Double Points page.
// Per-team, NOT global. The pick is changeable until the chosen round's answers
// are locked by the host (checked against quiz_sessions.locked_round_ids). The
// ×2 itself is applied at scoreboard-aggregation time (see utils/doubleUp.js).

// GET /api/doubleup/session/:sessionId → { choices: [{ team_id, round_id }] }
async function getSessionChoices(req, res) {
  try {
    const { sessionId } = req.params;
    const r = await db.query(
      'SELECT team_id, round_id FROM double_up_choices WHERE session_id = $1',
      [sessionId]
    );
    res.json({ choices: r.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// POST /api/doubleup/choose  Body: { sessionId, teamId, roundId }
// Upserts the team's single choice. Rejected if the target round is already
// locked, or if the team's existing pick's round is already locked (frozen).
async function chooseRound(req, res) {
  try {
    const { sessionId, teamId, roundId } = req.body;
    if (!sessionId || !teamId || !roundId) {
      return res.status(400).json({ error: 'sessionId, teamId and roundId are required' });
    }

    const sess = await db.query('SELECT locked_round_ids FROM quiz_sessions WHERE id = $1', [sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });
    const lockedRaw = sess.rows[0].locked_round_ids;
    const locked = (Array.isArray(lockedRaw) ? lockedRaw : []).map(Number);

    // Can't joker a round whose answers are already locked/revealed.
    if (locked.includes(Number(roundId))) {
      return res.status(409).json({ error: 'That round is already locked — pick a round that hasn\'t been revealed yet.' });
    }

    // Changeable until the chosen round locks: once the team's current pick's
    // round is locked, the choice is frozen.
    const existing = await db.query('SELECT round_id FROM double_up_choices WHERE team_id = $1', [teamId]);
    if (existing.rows.length && locked.includes(Number(existing.rows[0].round_id))) {
      return res.status(409).json({ error: 'Your double is locked in — that round has closed.' });
    }

    const up = await db.query(
      `INSERT INTO double_up_choices (team_id, session_id, round_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (team_id) DO UPDATE
         SET session_id = EXCLUDED.session_id,
             round_id   = EXCLUDED.round_id,
             updated_at = NOW()
       RETURNING team_id, round_id`,
      [teamId, sessionId, roundId]
    );
    const row = up.rows[0];

    const io = getIo();
    if (io) {
      io.to(`quiz-${sessionId}`).emit('doubleup_chosen', {
        teamId: Number(row.team_id),
        roundId: Number(row.round_id),
        timestamp: new Date().toISOString()
      });
    }

    res.status(201).json({ teamId: Number(row.team_id), roundId: Number(row.round_id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getSessionChoices, chooseRound };
