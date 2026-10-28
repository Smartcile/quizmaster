const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { getIo } = require('../sockets');
const { maybeAutoMark } = require('./answerController');
const deepseek = require('../services/deepseek');

const UPLOAD_DIR = path.join(__dirname, '../uploads');

// Every answer-sheet photo for a session (joined through its teams).
async function listSessionPhotos(req, res) {
  try {
    const { sessionId } = req.params;
    const result = await db.query(
      `SELECT p.id, p.team_id, p.round_id, p.url, p.filename,
              p.transcribed_text, p.transcribed_at, p.created_at
         FROM team_photos p
         JOIN teams t ON t.id = p.team_id
        WHERE t.quiz_session_id = $1
        ORDER BY p.created_at ASC`,
      [sessionId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Attach an uploaded photo to a team (and optionally a round).
async function uploadPhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded (expected an image file).' });
    const teamId = parseInt(req.params.teamId, 10);
    const roundId = req.body?.roundId ? parseInt(req.body.roundId, 10) : null;
    const url = `/uploads/${req.file.filename}`;
    const result = await db.query(
      `INSERT INTO team_photos (team_id, round_id, filename, url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, team_id, round_id, url, filename, transcribed_text, transcribed_at, created_at`,
      [teamId, roundId, req.file.filename, url]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deletePhoto(req, res) {
  try {
    const photoId = parseInt(req.params.photoId, 10);
    const found = await db.query('DELETE FROM team_photos WHERE id = $1 RETURNING filename', [photoId]);
    if (!found.rows.length) return res.status(404).json({ error: 'Photo not found' });
    try { fs.unlinkSync(path.join(UPLOAD_DIR, found.rows[0].filename)); } catch { /* already gone */ }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Map a single MCQ letter ("B") back to the option text so the normal
// answer-matching path scores it exactly like a typed answer.
function letterToOption(text, options) {
  const opts = Array.isArray(options) ? options.filter(o => String(o).trim()) : [];
  const t = String(text || '').trim();
  if (!opts.length || !/^[A-Za-z]$/.test(t)) return t;
  const opt = opts[t.toUpperCase().charCodeAt(0) - 65];
  return opt == null ? t : String(opt);
}

// Photo → text via the AI service, then write the answers the normal way so the
// usual auto-marking, sockets and scoreboard all run unchanged.
async function transcribePhoto(req, res) {
  if (!deepseek.isConfigured()) {
    return res.status(503).json({ error: 'AI marking is not configured. Set DEEPSEEK_API_KEY on the backend.' });
  }
  try {
    const photoId = parseInt(req.params.photoId, 10);
    const pr = await db.query(
      `SELECT p.*, t.quiz_session_id, t.name AS team_name
         FROM team_photos p
         JOIN teams t ON t.id = p.team_id
        WHERE p.id = $1`,
      [photoId]
    );
    if (!pr.rows.length) return res.status(404).json({ error: 'Photo not found' });
    const photo = pr.rows[0];
    if (!photo.round_id) return res.status(400).json({ error: 'This photo is not linked to a round.' });

    const qr = await db.query(
      `SELECT q.id, q.options, rq."order"
         FROM round_questions rq
         JOIN questions q ON q.id = rq.question_id
        WHERE rq.round_id = $1
        ORDER BY rq."order" ASC`,
      [photo.round_id]
    );
    const questions = qr.rows;
    if (!questions.length) return res.status(400).json({ error: 'That round has no questions.' });

    const texts = await deepseek.transcribeAnswerSheet(
      path.join(UPLOAD_DIR, photo.filename),
      questions.length
    );

    const applied = [];
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const text = letterToOption(texts[i], q.options);
        const existing = await client.query(
          'SELECT id FROM answers WHERE team_id = $1 AND question_id = $2',
          [photo.team_id, q.id]
        );
        if (existing.rows.length) {
          await client.query(
            'UPDATE answers SET answer_text = $1, updated_at = NOW() WHERE id = $2',
            [text, existing.rows[0].id]
          );
        } else {
          await client.query(
            'INSERT INTO answers (team_id, round_id, question_id, answer_text) VALUES ($1, $2, $3, $4)',
            [photo.team_id, photo.round_id, q.id, text]
          );
        }
        const points = await maybeAutoMark(client, photo.team_id, q.id, text);
        applied.push({ questionId: q.id, answer: text, points });
      }
      await client.query(
        'UPDATE team_photos SET transcribed_text = $1, transcribed_at = NOW() WHERE id = $2',
        [JSON.stringify(texts), photoId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const io = getIo();
    if (io) {
      const room = `quiz-${photo.quiz_session_id}`;
      io.to(room).emit('answer_submitted', { teamId: photo.team_id, roundId: photo.round_id });
      for (const a of applied) {
        if (a.points != null) {
          io.to(room).emit('answer_marked', {
            teamId: photo.team_id,
            questionId: a.questionId,
            points: a.points,
            autoMarked: true,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    res.json({
      photoId,
      teamId: photo.team_id,
      roundId: photo.round_id,
      answers: applied,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { listSessionPhotos, uploadPhoto, deletePhoto, transcribePhoto };
