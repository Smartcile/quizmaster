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
          `SELECT current_slide_index, status, locked_round_ids, scoreboard_visibility
           FROM quiz_sessions WHERE id = $1`,
          [sessionId]
        );
        if (sessRes.rows.length > 0) {
          const { current_slide_index, status, locked_round_ids, scoreboard_visibility } = sessRes.rows[0];
          socket.emit('session_state', {
            slideIndex:     current_slide_index || 0,
            status:         status || 'lobby',
            lockedRoundIds: locked_round_ids   || [],
            scoreboardVisibility: scoreboard_visibility || { slideshow: false, quizzer: false, admin: false }
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

      // Auto-zero: any team that never answered a question in this round (and
      // has no score yet) is explicitly marked 0 so it shows as 0 everywhere
      // (marking page, scoreboard, and the red "wrong" glow on the reveal).
      try {
        const zeroed = await db.query(
          `INSERT INTO scores (team_id, question_id, points_awarded, auto_marked)
           SELECT t.id, rq.question_id, 0, true
           FROM teams t
           CROSS JOIN round_questions rq
           WHERE t.quiz_session_id = $1
             AND rq.round_id = $2
             AND NOT EXISTS (
               SELECT 1 FROM scores s WHERE s.team_id = t.id AND s.question_id = rq.question_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM answers a WHERE a.team_id = t.id AND a.question_id = rq.question_id
             )
           RETURNING team_id, question_id`,
          [sessionId, roundId]
        );
        for (const r of zeroed.rows) {
          io.to(roomKey).emit('answer_marked', {
            teamId:     r.team_id,
            questionId: r.question_id,
            points:     0,
            autoMarked: true,
            timestamp:  new Date().toISOString()
          });
        }
        if (zeroed.rows.length) {
          console.log(`Session ${sessionId}: auto-zeroed ${zeroed.rows.length} unanswered in round ${roundId}`);
        }
      } catch (err) {
        console.error('answer_locked: auto-zero error:', err);
      }

      console.log(`Session ${sessionId}: round ${roundId} locked`);
    });

    // ── answer_unlocked ──────────────────────────────────────────────────────
    // Inverse of answer_locked — removes the round from locked_round_ids and
    // broadcasts so quizzers re-enable their answer inputs for that round.
    socket.on('answer_unlocked', async (data) => {
      const { sessionId, roundId } = data;
      const roomKey = `quiz-${sessionId}`;

      try {
        // Remove roundId from the JSONB array (idempotent — no-op if absent)
        await db.query(
          `UPDATE quiz_sessions
           SET locked_round_ids = COALESCE(
             (SELECT jsonb_agg(elem) FROM jsonb_array_elements(locked_round_ids) elem
              WHERE elem <> to_jsonb($1::int)),
             '[]'::jsonb
           )
           WHERE id = $2`,
          [roundId, sessionId]
        );
      } catch (err) {
        console.error('answer_unlocked: DB error:', err);
      }

      io.to(roomKey).emit('answer_unlocked', {
        roundId,
        timestamp: new Date().toISOString()
      });

      console.log(`Session ${sessionId}: round ${roundId} unlocked`);
    });

    // ── submit_answer ────────────────────────────────────────────────────────
    socket.on('submit_answer', async (data) => {
      const { sessionId, teamId, questionId, roundId, answer } = data;
      const roomKey = `quiz-${sessionId}`;

      let autoMarked = null;
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

        // Auto-mark: if no score yet and the submitted answer matches the
        // correct answer (fuzzy compare), award 1 point. Admin overrides
        // afterward via the marking page are never stomped because we skip
        // when a score row already exists.
        const scoreExists = await db.query(
          'SELECT id FROM scores WHERE team_id = $1 AND question_id = $2',
          [teamId, questionId]
        );
        if (!scoreExists.rows.length) {
          const qr = await db.query('SELECT answer FROM questions WHERE id = $1', [questionId]);
          if (qr.rows.length) {
            const norm = s => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/^the\s+/, '');
            if (norm(answer) === norm(qr.rows[0].answer)) {
              await db.query(
                'INSERT INTO scores (team_id, question_id, points_awarded) VALUES ($1, $2, 1)',
                [teamId, questionId]
              );
              autoMarked = 1;
            }
          }
        }

        io.to(roomKey).emit('answer_submitted', {
          teamId,
          questionId,
          timestamp: new Date().toISOString()
        });

        if (autoMarked != null) {
          io.to(roomKey).emit('answer_marked', {
            teamId,
            questionId,
            points: autoMarked,
            autoMarked: true,
            timestamp: new Date().toISOString()
          });
        }
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
