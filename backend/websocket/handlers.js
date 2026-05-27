const db = require('../config/database');

// Per-socket registry: socket.id → { sessionId, teamId, teamName, role, roomKey }
// Used only for cleanup on disconnect; all state is authoritative in the DB.
const quizSessions = new Map();

function setupWebSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`WS connected: ${socket.id}`);

    // ── join_quiz ────────────────────────────────────────────────────────────
    // Emitted by every client on first connect AND on every reconnect.
    // Returns a single session_state event with the full current show state so
    // the client can render without any additional REST calls.
    socket.on('join_quiz', async (data) => {
      const { sessionId, teamId, teamName, role } = data;
      const roomKey = `quiz-${sessionId}`;

      socket.join(roomKey);
      quizSessions.set(socket.id, { sessionId, teamId, teamName, role, roomKey });

      try {
        const sessRes = await db.query(
          `SELECT current_slide_index, status, locked_round_ids
           FROM quiz_sessions WHERE id = $1`,
          [sessionId]
        );
        if (sessRes.rows.length > 0) {
          const { current_slide_index, status, locked_round_ids } = sessRes.rows[0];
          socket.emit('session_state', {
            slideIndex:     current_slide_index || 0,
            status:         status || 'lobby',
            lockedRoundIds: locked_round_ids   || []
          });
        }
      } catch (err) {
        console.error('join_quiz: error fetching session state:', err);
      }

      // Announce team presence to all room members (admin uses this to count teams)
      if (teamId && teamName) {
        io.to(roomKey).emit('team_joined', {
          teamId,
          teamName,
          timestamp: new Date().toISOString()
        });
        console.log(`Team "${teamName}" joined session ${sessionId}`);
      } else {
        console.log(`${role || 'viewer'} joined session ${sessionId}`);
      }
    });

    // ── slide_changed ────────────────────────────────────────────────────────
    // Primary path: admin calls PUT /sessions/:id/slide (REST) which persists
    // then broadcasts via io directly.  This WS handler is kept as a fallback
    // (e.g. if the REST call fails) — it persists and broadcasts identically.
    socket.on('slide_changed', async (data) => {
      const { sessionId, slideIndex } = data;
      const roomKey = `quiz-${sessionId}`;

      try {
        await db.query(
          'UPDATE quiz_sessions SET current_slide_index = $1 WHERE id = $2',
          [slideIndex, sessionId]
        );
      } catch (err) {
        console.error('slide_changed: DB error:', err);
      }

      io.to(roomKey).emit('slide_changed', {
        slideIndex,
        timestamp: new Date().toISOString()
      });

      console.log(`Session ${sessionId}: slide → ${slideIndex}`);
    });

    // ── answer_locked ────────────────────────────────────────────────────────
    // Persists the locked round ID so rejoining clients receive it in
    // session_state.  Broadcasts to the room so quizzers disable inputs.
    socket.on('answer_locked', async (data) => {
      const { sessionId, roundId } = data;
      const roomKey = `quiz-${sessionId}`;

      try {
        // Append roundId only if not already present (idempotent)
        await db.query(
          `UPDATE quiz_sessions
           SET locked_round_ids = locked_round_ids || $1::jsonb
           WHERE id = $2
             AND NOT (locked_round_ids @> $1::jsonb)`,
          [JSON.stringify([roundId]), sessionId]
        );
      } catch (err) {
        console.error('answer_locked: DB error:', err);
      }

      io.to(roomKey).emit('answer_locked', {
        roundId,
        timestamp: new Date().toISOString()
      });

      console.log(`Session ${sessionId}: round ${roundId} locked`);
    });

    // ── submit_answer ────────────────────────────────────────────────────────
    socket.on('submit_answer', async (data) => {
      const { sessionId, teamId, questionId, roundId, answer } = data;
      const roomKey = `quiz-${sessionId}`;

      try {
        const existing = await db.query(
          'SELECT id FROM answers WHERE team_id = $1 AND question_id = $2',
          [teamId, questionId]
        );

        if (existing.rows.length > 0) {
          await db.query(
            'UPDATE answers SET answer_text = $1 WHERE team_id = $2 AND question_id = $3',
            [answer, teamId, questionId]
          );
        } else {
          await db.query(
            'INSERT INTO answers (team_id, round_id, question_id, answer_text) VALUES ($1, $2, $3, $4)',
            [teamId, roundId, questionId, answer]
          );
        }

        io.to(roomKey).emit('answer_submitted', {
          teamId,
          questionId,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error('submit_answer: error:', err);
      }
    });

    // ── session_status_changed ───────────────────────────────────────────────
    // Primary path: admin calls PUT /sessions/:id/status (REST), which persists
    // to DB then broadcasts via io.  This handler is kept as a fallback only.
    // It mirrors the REST behaviour: persist then broadcast.
    socket.on('session_status_changed', async (data) => {
      const { sessionId, status, currentSlideIndex } = data;
      const roomKey = `quiz-${sessionId}`;

      const valid = ['lobby', 'active', 'finished'];
      if (!valid.includes(status)) return;

      try {
        await db.query(
          `UPDATE quiz_sessions SET status = $1 WHERE id = $2`,
          [status, sessionId]
        );
      } catch (err) {
        console.error('session_status_changed: DB error:', err);
      }

      io.to(roomKey).emit('session_status_changed', {
        status,
        currentSlideIndex: currentSlideIndex ?? 0,
        timestamp: new Date().toISOString()
      });

      console.log(`Session ${sessionId}: status → ${status}`);
    });

    // ── mark_answer ──────────────────────────────────────────────────────────
    socket.on('mark_answer', async (data) => {
      const { sessionId, teamId, questionId, points } = data;
      const roomKey = `quiz-${sessionId}`;

      try {
        const existing = await db.query(
          'SELECT id FROM scores WHERE team_id = $1 AND question_id = $2',
          [teamId, questionId]
        );

        if (existing.rows.length > 0) {
          await db.query(
            'UPDATE scores SET points_awarded = $1 WHERE team_id = $2 AND question_id = $3',
            [points, teamId, questionId]
          );
        } else {
          await db.query(
            'INSERT INTO scores (team_id, question_id, points_awarded) VALUES ($1, $2, $3)',
            [teamId, questionId, points]
          );
        }

        io.to(roomKey).emit('answer_marked', {
          teamId,
          questionId,
          points,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error('mark_answer: error:', err);
      }
    });

    // ── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const meta = quizSessions.get(socket.id);
      if (meta) {
        quizSessions.delete(socket.id);
        console.log(`WS disconnected: ${socket.id} (${meta.role || 'viewer'}) reason=${reason}`);
      }
    });
  });
}

module.exports = { setupWebSocketHandlers };
