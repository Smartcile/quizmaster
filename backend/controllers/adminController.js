const db = require('../config/database');
const path = require('path');
const fs = require('fs');

// POST /api/admin/reset — bulk "Delete All" for the Settings danger zone.
// Body flags pick what to wipe: { questions, rounds, quizzes, sessions, media }.
// Deletes inside a transaction in FK-safe order. Note: answers/scores reference
// questions/rounds WITHOUT cascade, so wiping questions or rounds also clears
// all session results (quiz_sessions cascade) — the frontend warns about this.
async function resetData(req, res) {
  const b = req.body || {};
  const wipe = {
    questions: !!b.questions,
    rounds:    !!b.rounds,
    quizzes:   !!b.quizzes,
    sessions:  !!b.sessions,
    media:     !!b.media,
  };
  if (!Object.values(wipe).some(Boolean)) {
    return res.status(400).json({ error: 'Nothing selected to delete' });
  }

  const client = await db.getClient();
  const deleted = {};
  try {
    await client.query('BEGIN');

    // Session data (answers/scores/teams/brownie/whoami) hangs off quiz_sessions
    // and references questions/rounds without cascade — clear it first whenever
    // any content that it points at is being removed.
    if (wipe.sessions || wipe.questions || wipe.rounds || wipe.quizzes) {
      const r = await client.query('DELETE FROM quiz_sessions RETURNING id');
      deleted.sessions = r.rowCount;
    }
    if (wipe.quizzes) {
      const r = await client.query('DELETE FROM quizzes RETURNING id');     // cascades quiz_rounds/quiz_widgets/slides
      deleted.quizzes = r.rowCount;
    }
    if (wipe.rounds) {
      const r = await client.query('DELETE FROM rounds RETURNING id');      // cascades round_questions/quiz_rounds
      deleted.rounds = r.rowCount;
    }
    if (wipe.questions) {
      const r = await client.query('DELETE FROM questions RETURNING id');   // cascades round_questions
      deleted.questions = r.rowCount;
    }
    if (wipe.media) {
      const files = await client.query('SELECT filename FROM media_files');
      const r = await client.query('DELETE FROM media_files RETURNING id');
      deleted.media = r.rowCount;
      // Remove the files from disk (best-effort — DB row removal is what counts).
      for (const f of files.rows) {
        try { fs.unlinkSync(path.join(__dirname, '../uploads', f.filename)); } catch { /* already gone */ }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, deleted });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { resetData };
