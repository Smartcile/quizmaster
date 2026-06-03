const db = require('../config/database');
const crypto = require('crypto');

// ── GitHub CSV question repositories ─────────────────────────────────────────
// Repos are synced on demand: we resolve the configured repo/branch/path to one
// or more raw CSV files over HTTPS (GitHub contents + raw APIs — no git binary),
// parse them, and import the questions with de-duplication + source labelling:
//   * a brand-new question → inserted with source = 'repo'
//   * a question whose text already exists as 'local' → relabelled 'both' (L&R)
//   * one already 'repo' / 'both' → compared by content hash; a mismatch is
//     reported as "changed" (and overwritten when ?apply=true).

// Accent/punctuation-insensitive key for duplicate matching.
const norm = (s) => String(s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[–—−-]/g, ' ')
  .replace(/[^\p{L}\p{N} ]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^the\s+/, '');

// Tidy text for storage (smart quotes/dashes/ellipsis → ASCII, keep accents).
const cleanText = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[‘’‚‛′]/g, "'")
  .replace(/[“”„″]/g, '"')
  .replace(/[–—−]/g, '-')
  .replace(/…/g, '...')
  .replace(/ /g, ' ')
  .trim();

// Content fingerprint used to detect repo-side edits between syncs.
const contentHash = (q) => crypto.createHash('sha1')
  .update([
    cleanText(q.text), cleanText(q.answer),
    (Array.isArray(q.options) ? q.options.map(cleanText) : []).join(''),
    String(q.points ?? ''), String(q.type ?? ''), String(q.difficulty ?? '')
  ].join(''))
  .digest('hex');

// Parse a GitHub URL into { owner, repo, branch, path }. Accepts:
//   https://github.com/owner/repo
//   https://github.com/owner/repo/tree/branch/sub/dir
//   https://github.com/owner/repo/blob/branch/path/file.csv
//   https://raw.githubusercontent.com/owner/repo/branch/path/file.csv
function parseGitHubUrl(input) {
  const url = String(input || '').trim();
  let m = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (m) return { owner: m[1], repo: m[2], branch: m[3], path: m[4] };
  m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)\/(.+))?\/?$/i);
  if (m) return { owner: m[1], repo: m[2], branch: m[3] || null, path: m[4] || '' };
  return null;
}

const GH_HEADERS = {
  'User-Agent': 'quiz-master',
  'Accept': 'application/vnd.github+json'
};

// Resolve a repo config to a list of { name, url } raw CSV files.
async function resolveCsvFiles({ owner, repo, branch, path }) {
  const ref = branch || 'main';
  const cleanPath = (path || '').replace(/^\/+|\/+$/g, '');

  // Direct .csv path → single raw file (no API call / rate limit needed)
  if (/\.csv$/i.test(cleanPath)) {
    return [{
      name: cleanPath.split('/').pop(),
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${cleanPath}`
    }];
  }

  // Otherwise list the folder via the contents API and pick out .csv files
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(apiUrl, { headers: GH_HEADERS });
  if (!res.ok) {
    const detail = res.status === 404 ? 'repo, branch or path not found'
      : res.status === 403 ? 'GitHub rate limit reached — try again later'
      : `GitHub responded ${res.status}`;
    throw new Error(detail);
  }
  const body = await res.json();
  const entries = Array.isArray(body) ? body : [body];
  return entries
    .filter(e => e.type === 'file' && /\.csv$/i.test(e.name) && e.download_url)
    .map(e => ({ name: e.name, url: e.download_url }));
}

// Minimal RFC-4180-ish CSV parser (quoted fields, "" escapes, CR/LF).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

// Header-driven CSV → question objects (same format as the export/import).
function csvToQuestions(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const idx = (n) => headers.indexOf(n);
  const textCol = idx('question') !== -1 ? idx('question') : idx('text');
  const cell = (cells, n) => { const i = idx(n); return i === -1 ? '' : (cells[i] ?? '').trim(); };
  return rows.slice(1).map(cells => {
    const opts = cell(cells, 'options');
    return {
      text: cleanText(textCol === -1 ? '' : (cells[textCol] ?? '')),
      answer: cleanText(cell(cells, 'answer')),
      type: cell(cells, 'type') || 'text',
      points: parseFloat(cell(cells, 'points')) || 1,
      media_url: cell(cells, 'media_url') || null,
      category: cell(cells, 'category') || null,
      difficulty: cell(cells, 'difficulty') || 'medium',
      answer_mode: cell(cells, 'answer_mode') || 'text',
      question_format: cell(cells, 'question_format') || 'standard',
      approved: cell(cells, 'approved').toLowerCase() === 'true',
      options: opts ? opts.split('|').map(o => cleanText(o)).filter(Boolean) : []
    };
  }).filter(q => q.text);
}

async function listRepos(req, res) {
  try {
    const result = await db.query('SELECT * FROM question_repos ORDER BY created_at');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function addRepo(req, res) {
  try {
    const { label, url, branch, path } = req.body;
    if (!url || !String(url).trim()) return res.status(400).json({ error: 'A GitHub URL is required' });

    const parsed = parseGitHubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Not a recognised GitHub URL' });

    const result = await db.query(
      `INSERT INTO question_repos (label, url, owner, repo, branch, path)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        (label && label.trim()) || `${parsed.owner}/${parsed.repo}`,
        url.trim(),
        parsed.owner,
        parsed.repo,
        branch || parsed.branch || 'main',
        (path != null && path !== '') ? path : (parsed.path || '')
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateRepo(req, res) {
  try {
    const { label, url, branch, path } = req.body;
    if (!url || !String(url).trim()) return res.status(400).json({ error: 'A GitHub URL is required' });

    const parsed = parseGitHubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Not a recognised GitHub URL' });

    const result = await db.query(
      `UPDATE question_repos
       SET label = $1, url = $2, owner = $3, repo = $4, branch = $5, path = $6
       WHERE id = $7 RETURNING *`,
      [
        (label && label.trim()) || `${parsed.owner}/${parsed.repo}`,
        url.trim(),
        parsed.owner,
        parsed.repo,
        branch || parsed.branch || 'main',
        (path != null && path !== '') ? path : (parsed.path || ''),
        req.params.id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Repository not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteRepo(req, res) {
  try {
    const result = await db.query('DELETE FROM question_repos WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Repository not found' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// POST /api/repos/:id/sync — fetch CSVs and import with de-dup + labelling.
// ?apply=true (or body.apply) also overwrites locally-stored repo questions
// whose repo copy has changed; otherwise those are reported as "changed".
async function syncRepo(req, res) {
  const QUESTION_FIELDS = 'text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode, approved, question_format, source, repo_hash';
  const apply = req.body?.apply === true || req.query.apply === 'true';
  try {
    const repoRow = await db.query('SELECT * FROM question_repos WHERE id = $1', [req.params.id]);
    if (repoRow.rows.length === 0) return res.status(404).json({ error: 'Repository not found' });
    const cfg = repoRow.rows[0];

    const files = await resolveCsvFiles(cfg);
    if (files.length === 0) {
      return res.status(400).json({ error: 'No .csv files found at that repo/branch/path' });
    }

    // Gather all questions across every CSV file
    const parsed = [];
    for (const f of files) {
      const r = await fetch(f.url, { headers: GH_HEADERS });
      if (!r.ok) continue;
      const text = await r.text();
      parsed.push(...csvToQuestions(text));
    }
    if (parsed.length === 0) {
      return res.status(400).json({ error: 'CSV files contained no questions' });
    }

    // Existing questions indexed by normalised text
    const existing = await db.query('SELECT id, text, source, repo_hash FROM questions');
    const byText = new Map(existing.rows.map(q => [norm(q.text), q]));

    const summary = { added: 0, relabeled: 0, ignored: 0, updated: 0, changed: [], files: files.length, applied: apply };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const q of parsed) {
        const match = byText.get(norm(q.text));
        const hash = contentHash(q);
        // Questions carrying MCQ options are flagged multiple choice so the
        // options can't be hidden behind a plain 'text' answer mode. The 'both'
        // mode (quizzer chooses MCQ vs free-text) is preserved as-is.
        const hasOpts = Array.isArray(q.options) && q.options.filter(o => String(o).trim()).length > 0;
        const promote = hasOpts && q.answer_mode !== 'both';
        const answerMode = promote ? 'mcq' : q.answer_mode;
        const qFormat = promote ? 'multichoice' : q.question_format;
        const optsJson = JSON.stringify(q.options || []);

        if (!match) {
          await client.query(
            `INSERT INTO questions (${QUESTION_FIELDS})
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'repo',$13)`,
            [q.text, q.answer, q.type, q.media_url, q.points, null, q.category,
             optsJson, q.difficulty, answerMode, q.approved, qFormat, hash]
          );
          summary.added++;
          byText.set(norm(q.text), { id: null, text: q.text, source: 'repo', repo_hash: hash });
        } else if (match.source === 'local') {
          // Link the local question to the repo + record the baseline hash
          await client.query("UPDATE questions SET source = 'both', repo_hash = $1 WHERE id = $2", [hash, match.id]);
          match.source = 'both'; match.repo_hash = hash;
          summary.relabeled++;
        } else if (match.repo_hash && match.repo_hash !== hash) {
          // Repo copy changed since import
          if (apply && match.id) {
            await client.query(
              `UPDATE questions SET text=$1, answer=$2, type=$3, media_url=$4, points=$5,
                 category=$6, options=$7, difficulty=$8, answer_mode=$9, question_format=$10, repo_hash=$11
               WHERE id=$12`,
              [q.text, q.answer, q.type, q.media_url, q.points, q.category, optsJson,
               q.difficulty, answerMode, qFormat, hash, match.id]
            );
            match.repo_hash = hash;
            summary.updated++;
          } else {
            summary.changed.push({ id: match.id, text: q.text });
          }
        } else if (!match.repo_hash && match.id) {
          // Existing repo/both question with no baseline yet — record one
          await client.query('UPDATE questions SET repo_hash = $1 WHERE id = $2', [hash, match.id]);
          match.repo_hash = hash;
          summary.ignored++;
        } else {
          summary.ignored++;
        }
      }
      await client.query(
        'UPDATE question_repos SET last_synced_at = NOW(), last_count = $1 WHERE id = $2',
        [summary.added, cfg.id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { listRepos, addRepo, updateRepo, deleteRepo, syncRepo };
