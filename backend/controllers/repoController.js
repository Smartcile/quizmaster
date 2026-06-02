const db = require('../config/database');

// ── GitHub CSV question repositories ─────────────────────────────────────────
// Repos are synced on demand: we resolve the configured repo/branch/path to one
// or more raw CSV files over HTTPS (GitHub contents + raw APIs — no git binary),
// parse them, and import the questions with de-duplication + source labelling:
//   * a brand-new question → inserted with source = 'repo'
//   * a question whose text already exists as 'local' → relabelled 'both' (L&R)
//   * one already 'repo' / 'both' → left alone (never duplicated)

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

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
      text: textCol === -1 ? '' : (cells[textCol] ?? '').trim(),
      answer: cell(cells, 'answer'),
      type: cell(cells, 'type') || 'text',
      points: parseFloat(cell(cells, 'points')) || 1,
      media_url: cell(cells, 'media_url') || null,
      category: cell(cells, 'category') || null,
      difficulty: cell(cells, 'difficulty') || 'medium',
      answer_mode: cell(cells, 'answer_mode') || 'text',
      question_format: cell(cells, 'question_format') || 'standard',
      approved: cell(cells, 'approved').toLowerCase() === 'true',
      options: opts ? opts.split('|').map(o => o.trim()).filter(Boolean) : []
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
async function syncRepo(req, res) {
  const QUESTION_FIELDS = 'text, answer, type, media_url, points, tags, category, options, difficulty, answer_mode, approved, question_format, source';
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
    const existing = await db.query('SELECT id, text, source FROM questions');
    const byText = new Map(existing.rows.map(q => [norm(q.text), q]));

    const summary = { added: 0, relabeled: 0, ignored: 0, files: files.length };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const q of parsed) {
        const match = byText.get(norm(q.text));
        if (!match) {
          await client.query(
            `INSERT INTO questions (${QUESTION_FIELDS})
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'repo')`,
            [q.text, q.answer, q.type, q.media_url, q.points, null, q.category,
             JSON.stringify(q.options || []), q.difficulty, q.answer_mode, q.approved, q.question_format]
          );
          summary.added++;
          // Track so a later CSV in the same sync doesn't re-insert it
          byText.set(norm(q.text), { id: null, text: q.text, source: 'repo' });
        } else if (match.source === 'local') {
          await client.query("UPDATE questions SET source = 'both' WHERE id = $1", [match.id]);
          match.source = 'both';
          summary.relabeled++;
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
