const db = require('../config/database');
const { cleanText, cleanOptions } = require('../utils/cleanText');

const QUESTION_FIELDS = 'text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode, approved, question_format, audio_form, audio_stop_seconds';

// A question that carries MCQ options must never be a plain 'text' question —
// the options would be hidden from the quizzer. Such a question is promoted to
// 'mcq' / 'multichoice'. The 'both' mode is intentional (the quizzer chooses
// whether the question is shown as multiple-choice or free-text) and is always
// preserved. Returns the resolved { answer_mode, question_format } pair.
function resolveMcqMode(options, answer_mode, question_format) {
  const opts = Array.isArray(options) ? options.filter(o => String(o).trim()) : [];
  const mode = answer_mode || 'text';
  const fmt = question_format || 'standard';
  if (opts.length > 0 && mode !== 'both') {
    return { answer_mode: 'mcq', question_format: 'multichoice' };
  }
  return { answer_mode: mode, question_format: fmt };
}

async function getAllQuestions(req, res) {
  try {
    const { category, search, difficulty, approved } = req.query;
    const conditions = [];
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (difficulty && difficulty !== 'all') {
      params.push(difficulty);
      conditions.push(`difficulty = $${params.length}`);
    }
    if (approved === 'true' || approved === 'false') {
      params.push(approved === 'true');
      conditions.push(`approved = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(text ILIKE $${params.length} OR answer ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT * FROM questions ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getCategories(req, res) {
  // Return the union of (a) the managed categories table and (b) any legacy
  // categories that still appear on questions but aren't in the table. Keeps
  // the QuestionManager dropdown showing every category currently in use.
  try {
    const result = await db.query(`
      SELECT name FROM (
        SELECT name, sort_order, 0 AS legacy FROM categories
        UNION
        SELECT DISTINCT q.category AS name, 9999 AS sort_order, 1 AS legacy
        FROM questions q
        WHERE q.category IS NOT NULL AND q.category <> ''
          AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = q.category)
      ) all_cats
      ORDER BY sort_order, name
    `);
    res.json(result.rows.map(r => r.name));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getStats(req, res) {
  try {
    const [questions, rounds, quizzes, sessions, byDifficulty, byCategory] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS count FROM questions'),
      db.query('SELECT COUNT(*)::int AS count FROM rounds'),
      db.query('SELECT COUNT(*)::int AS count FROM quizzes'),
      db.query("SELECT COUNT(*)::int AS count FROM quiz_sessions WHERE status IN ('lobby', 'active') AND is_test = FALSE"),
      db.query("SELECT COALESCE(difficulty, 'medium') AS difficulty, COUNT(*)::int AS count FROM questions GROUP BY difficulty"),
      db.query("SELECT COALESCE(category, '(uncategorized)') AS category, COUNT(*)::int AS count FROM questions GROUP BY category ORDER BY count DESC LIMIT 10")
    ]);

    res.json({
      questions: questions.rows[0].count,
      rounds: rounds.rows[0].count,
      quizzes: quizzes.rows[0].count,
      activeSessions: sessions.rows[0].count,
      byDifficulty: byDifficulty.rows,
      byCategory: byCategory.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getQuestion(req, res) {
  try {
    const result = await db.query('SELECT * FROM questions WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createQuestion(req, res) {
  try {
    const { text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode, approved, question_format } = req.body;
    const isWhoami = req.body.is_whoami === true;
    // Who/What Am I sets store their clues ([{text,points}]) in options and are
    // never multiple-choice; everything else goes through the MCQ resolver.
    // Tidy special characters on the way in (smart quotes/dashes/etc.)
    const cText = cleanText(text), cAnswer = cleanText(answer), cOptions = cleanOptions(options || []);
    const am = isWhoami ? 'text'     : resolveMcqMode(cOptions, answer_mode, question_format).answer_mode;
    const qf = isWhoami ? 'standard' : resolveMcqMode(cOptions, answer_mode, question_format).question_format;
    // Audio round form — only meaningful for audio questions.
    const audioForm = (type === 'audio' && req.body.audio_form) ? req.body.audio_form : null;
    const audioStop = (type === 'audio' && req.body.audio_stop_seconds != null && req.body.audio_stop_seconds !== '')
      ? Number(req.body.audio_stop_seconds) : null;
    const result = await db.query(
      `INSERT INTO questions (text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode, approved, question_format, is_whoami, audio_form, audio_stop_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [cText, cAnswer, type || 'text', media_url, points, tags, category,
       JSON.stringify(cOptions), difficulty || 'medium', am,
       approved ?? false, qf, isWhoami, audioForm, audioStop]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateQuestion(req, res) {
  try {
    const { text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode, approved, question_format } = req.body;
    const isWhoami = req.body.is_whoami === true;
    const cText = cleanText(text), cAnswer = cleanText(answer), cOptions = cleanOptions(options || []);
    const am = isWhoami ? 'text'     : resolveMcqMode(cOptions, answer_mode, question_format).answer_mode;
    const qf = isWhoami ? 'standard' : resolveMcqMode(cOptions, answer_mode, question_format).question_format;
    const audioForm = (type === 'audio' && req.body.audio_form) ? req.body.audio_form : null;
    const audioStop = (type === 'audio' && req.body.audio_stop_seconds != null && req.body.audio_stop_seconds !== '')
      ? Number(req.body.audio_stop_seconds) : null;
    const result = await db.query(
      `UPDATE questions SET text=$1, answer=$2, type=$3, media_url=$4, points=$5,
       tags=$6, category=$7, options=$8, difficulty=$9, answer_mode=$10,
       approved=$11, question_format=$12, is_whoami=$13, audio_form=$14, audio_stop_seconds=$15
       WHERE id=$16 RETURNING *`,
      [cText, cAnswer, type || 'text', media_url, points, tags, category,
       JSON.stringify(cOptions), difficulty || 'medium', am,
       approved ?? false, qf, isWhoami, audioForm, audioStop,
       req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── exportQuestionsCSV ─────────────────────────────────────────────────────
// GET /api/questions/export
// Streams the entire question bank as a CSV file. Columns match the import
// format so the same file can be re-imported via the CSV importer.
async function exportQuestionsCSV(req, res) {
  try {
    const result = await db.query(
      `SELECT text, answer, type, points, media_url, category, difficulty,
              answer_mode, question_format, approved, options
       FROM questions
       ORDER BY category NULLS LAST, created_at`
    );

    const headers = [
      'question', 'answer', 'type', 'points', 'media_url',
      'category', 'difficulty', 'answer_mode', 'question_format',
      'approved', 'options'
    ];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const row of result.rows) {
      lines.push([
        row.text, row.answer, row.type, row.points, row.media_url,
        row.category, row.difficulty, row.answer_mode, row.question_format,
        row.approved ? 'true' : 'false',
        // Options is a JSONB array — serialise to a single CSV cell as "a|b|c"
        Array.isArray(row.options) ? row.options.join('|') : ''
      ].map(escape).join(','));
    }
    const csv = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="quiz-master-questions.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── importQuestions ─────────────────────────────────────────────────────────
// POST /api/questions/import
// Body: { items: [ { action, question: {...fields}, existingId? } ] }
//   action: 'add' | 'copy' | 'overwrite' | 'ignore'
//     add       → INSERT the question as-is
//     copy      → INSERT with " (COPY)" appended to the text
//     overwrite → UPDATE the existing row (existingId) with the new fields
//     ignore    → skip entirely
// Returns a summary { added, copied, overwritten, ignored } where the first
// three are arrays of question texts (for the success popup) and ignored a count.
async function importQuestions(req, res) {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items must be an array' });
  }

  const norm = (q) => {
    const cOptions = cleanOptions(Array.isArray(q.options) ? q.options : []);
    const mode = resolveMcqMode(cOptions, q.answer_mode, q.question_format);
    return {
      text: cleanText(q.text),
      answer: cleanText(q.answer),
      type: q.type || 'text',
      media_url: q.media_url || null,
      points: q.points ?? 1,
      tags: q.tags || null,
      category: q.category || null,
      options: JSON.stringify(cOptions),
      difficulty: q.difficulty || 'medium',
      answer_mode: mode.answer_mode,
      approved: q.approved ?? false,
      question_format: mode.question_format,
      audio_form: (q.type === 'audio' && q.audio_form) ? q.audio_form : null,
      audio_stop_seconds: (q.type === 'audio' && q.audio_stop_seconds != null && q.audio_stop_seconds !== '')
        ? Number(q.audio_stop_seconds) : null
    };
  };

  const summary = { added: [], copied: [], overwritten: [], ignored: 0 };
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const action = item?.action || 'add';
      const q = item?.question || {};
      if (action === 'ignore') { summary.ignored++; continue; }

      if (action === 'overwrite' && item.existingId) {
        const f = norm(q);
        await client.query(
          `UPDATE questions SET text=$1, answer=$2, type=$3, media_url=$4, points=$5,
             tags=$6, category=$7, options=$8, difficulty=$9, answer_mode=$10,
             approved=$11, question_format=$12, audio_form=$13, audio_stop_seconds=$14
           WHERE id=$15`,
          [f.text, f.answer, f.type, f.media_url, f.points, f.tags, f.category,
           f.options, f.difficulty, f.answer_mode, f.approved, f.question_format,
           f.audio_form, f.audio_stop_seconds, item.existingId]
        );
        summary.overwritten.push(f.text);
        continue;
      }

      // add or copy → INSERT (copy appends a " (COPY)" label to the text)
      const f = norm(q);
      const text = action === 'copy' ? `${f.text} (COPY)` : f.text;
      await client.query(
        `INSERT INTO questions (${QUESTION_FIELDS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [text, f.answer, f.type, f.media_url, f.points, f.tags, f.category,
         f.options, f.difficulty, f.answer_mode, f.approved, f.question_format,
         f.audio_form, f.audio_stop_seconds]
      );
      (action === 'copy' ? summary.copied : summary.added).push(text);
    }
    await client.query('COMMIT');
    res.json(summary);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}

// ── cleanSpecialCharacters ────────────────────────────────────────────────────
// POST /api/questions/clean-special-chars
// Bulk "reformat" pass over the whole bank: tidy smart quotes/dashes/ellipsis/
// non-breaking spaces in text, answer and options for questions already stored
// (imported or entered before cleaning existed). Only rows that actually change
// are written. Returns { cleaned, total }.
async function cleanSpecialCharacters(req, res) {
  const client = await db.getClient();
  try {
    const all = await db.query('SELECT id, text, answer, options FROM questions');
    let cleaned = 0;
    await client.query('BEGIN');
    for (const q of all.rows) {
      const nt = cleanText(q.text);
      const na = cleanText(q.answer);
      const storedOpts = Array.isArray(q.options) ? q.options : [];
      const no = cleanOptions(storedOpts);
      const optsChanged = JSON.stringify(no) !== JSON.stringify(storedOpts);
      if (nt !== (q.text ?? '') || na !== (q.answer ?? '') || optsChanged) {
        await client.query('UPDATE questions SET text=$1, answer=$2, options=$3 WHERE id=$4',
          [nt, na, JSON.stringify(no), q.id]);
        cleaned++;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, cleaned, total: all.rows.length });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}

async function deleteQuestion(req, res) {
  try {
    const result = await db.query('DELETE FROM questions WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question deleted', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllQuestions,
  getCategories,
  getStats,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  exportQuestionsCSV,
  importQuestions,
  cleanSpecialCharacters
};
