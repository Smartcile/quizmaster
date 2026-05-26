const db = require('../config/database');

const quizSessions = new Map();

function setupWebSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join_quiz', async (data) => {
      const { sessionId, teamId, teamName, role } = data;
      const roomKey = `quiz-${sessionId}`;

      socket.join(roomKey);
      quizSessions.set(socket.id, { sessionId, teamId, teamName, role, roomKey });

      // Send current slide index to newly-joined client so it catches up
      try {
        const sessRes = await db.query(
          'SELECT current_slide_index FROM quiz_sessions WHERE id = $1',
          [sessionId]
        );
        if (sessRes.rows.length > 0) {
          socket.emit('slide_changed', {
            slideIndex: sessRes.rows[0].current_slide_index || 0,
            timestamp: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error('Error fetching current slide:', err);
      }

      // Only announce team joins, not viewers
      if (teamId && teamName) {
        io.to(roomKey).emit('team_joined', {
          teamId,
          teamName,
          timestamp: new Date().toISOString()
        });
        console.log(`Team ${teamName} joined quiz session ${sessionId}`);
      } else {
        console.log(`Viewer (${role || 'unknown'}) joined quiz session ${sessionId}`);
      }
    });

    socket.on('slide_changed', async (data) => {
      const { sessionId, slideIndex, slideData } = data;
      const roomKey = `quiz-${sessionId}`;

      await db.query(
        'UPDATE quiz_sessions SET current_slide_index = $1 WHERE id = $2',
        [slideIndex, sessionId]
      );

      io.to(roomKey).emit('slide_changed', {
        slideIndex,
        slideData,
        timestamp: new Date().toISOString()
      });

      console.log(`Slide changed in session ${sessionId} to index ${slideIndex}`);
    });

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
      } catch (error) {
        console.error('Error submitting answer:', error);
      }
    });

    socket.on('session_status_changed', async (data) => {
      // Broadcasts a session lifecycle event so slideshow + quizzers update immediately.
      const { sessionId, status, currentSlideIndex } = data;
      const roomKey = `quiz-${sessionId}`;
      io.to(roomKey).emit('session_status_changed', {
        status,
        currentSlideIndex: currentSlideIndex ?? 0,
        timestamp: new Date().toISOString()
      });
      console.log(`Session ${sessionId} status -> ${status}`);
    });

    socket.on('answer_locked', async (data) => {
      const { sessionId, roundId } = data;
      const roomKey = `quiz-${sessionId}`;

      io.to(roomKey).emit('answer_locked', {
        roundId,
        timestamp: new Date().toISOString()
      });

      console.log(`Answers locked for round ${roundId} in session ${sessionId}`);
    });

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
      } catch (error) {
        console.error('Error marking answer:', error);
      }
    });

    socket.on('disconnect', () => {
      const sessionData = quizSessions.get(socket.id);
      if (sessionData) {
        quizSessions.delete(socket.id);
        console.log(`Client disconnected: ${socket.id}`);
      }
    });
  });
}

module.exports = { setupWebSocketHandlers };
