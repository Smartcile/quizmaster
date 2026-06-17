const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Read ID3/audio tags from a file on disk. Returns {} on any failure so an
// untagged or non-audio file never breaks the upload.
async function readAudioTags(diskPath) {
  try {
    const mm = await import('music-metadata');           // ESM pkg, dynamic import for CJS
    const meta = await mm.parseFile(diskPath, { duration: true });
    const c = meta.common || {};
    return {
      artist: c.artist || (Array.isArray(c.artists) ? c.artists[0] : null) || null,
      title: c.title || null,
      album: c.album || null,
      duration_seconds: meta.format?.duration != null ? Number(meta.format.duration.toFixed(3)) : null,
    };
  } catch {
    return {};
  }
}

router.post('/media', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const url = `/uploads/${req.file.filename}`;
  // Optional friendly name + virtual folder (sent by the editors / picker as
  // multipart text fields). display_name falls back to the original filename.
  const displayName = (req.body?.display_name || '').trim() || req.file.originalname;
  const folder = (req.body?.folder || '').trim() || null;

  // Audio metadata: parse tags from the file, but let the caller override (the
  // in-browser editors pass the source track's metadata so a re-encoded clip,
  // which has no tags, keeps artist/title/album/lyrics).
  let meta = {};
  if ((req.file.mimetype || '').startsWith('audio/')) {
    meta = await readAudioTags(req.file.path);
  }
  const pick = (k) => {
    const fromBody = (req.body?.[k] || '').trim?.() ?? req.body?.[k];
    return (fromBody || meta[k] || null);
  };
  const artist = pick('artist');
  const title  = pick('title');
  const album  = pick('album');
  const duration_seconds = req.body?.duration_seconds ? Number(req.body.duration_seconds)
    : (meta.duration_seconds ?? null);
  const lyrics = (req.body?.lyrics || '').trim() || null;
  const lyricsSynced = String(req.body?.lyrics_synced) === 'true';
  // A "Finish the Lyrics" answer marked in the audio editor — remembered on the
  // file so a question that picks it can auto-import the missing lyrics + cut.
  const ftlAnswer = (req.body?.ftl_answer || '').trim() || null;
  const ftlStop = (req.body?.ftl_stop_seconds != null && req.body.ftl_stop_seconds !== '')
    ? Number(req.body.ftl_stop_seconds) : null;

  let row = null;
  try {
    const r = await db.query(
      `INSERT INTO media_files
         (filename, original_name, display_name, folder, mime_type, size_bytes, url,
          artist, title, album, duration_seconds, lyrics, lyrics_synced, ftl_answer, ftl_stop_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (filename) DO NOTHING RETURNING *`,
      [req.file.filename, req.file.originalname, displayName, folder, req.file.mimetype, req.file.size, url,
       artist, title, album, duration_seconds, lyrics, lyricsSynced, ftlAnswer, ftlStop]
    );
    row = r.rows[0] || null;
  } catch { /* non-fatal — media library tracking is best-effort */ }
  res.json({
    filename: req.file.filename,
    url,
    size: req.file.size,
    original_name: req.file.originalname,
    display_name: displayName,
    folder,
    mime_type: req.file.mimetype,
    artist, title, album, duration_seconds,
    lyrics, lyrics_synced: lyricsSynced,
    ftl_answer: ftlAnswer, ftl_stop_seconds: ftlStop,
    ...(row ? { id: row.id } : {})
  });
});

// PUT /api/upload/media/:id — overwrite an EXISTING file's bytes in place. The
// filename + url are kept, so every question/slide already pointing at this file
// instantly gets the edited version (used by the editors' "Overwrite original").
router.put('/media/:id', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const r = await db.query('SELECT * FROM media_files WHERE id = $1', [req.params.id]);
    if (!r.rows.length) {
      try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
      return res.status(404).json({ error: 'File not found' });
    }
    const existing = r.rows[0];
    const destPath = path.join(__dirname, '../uploads', existing.filename);
    // Replace the bytes at the original on-disk path, then drop the temp upload.
    fs.renameSync(req.file.path, destPath);

    const num = (v) => (v != null && v !== '' ? Number(v) : null);
    const lyrics = (req.body?.lyrics || '').trim() || null;
    const lyricsSynced = req.body?.lyrics_synced != null ? String(req.body.lyrics_synced) === 'true' : existing.lyrics_synced;
    const ftlAnswer = req.body?.ftl_answer !== undefined ? ((req.body.ftl_answer || '').trim() || null) : existing.ftl_answer;
    const ftlStop = req.body?.ftl_stop_seconds !== undefined ? num(req.body.ftl_stop_seconds) : existing.ftl_stop_seconds;

    const upd = await db.query(
      `UPDATE media_files
         SET size_bytes = $1,
             duration_seconds = COALESCE($2, duration_seconds),
             lyrics = COALESCE($3, lyrics),
             lyrics_synced = $4,
             ftl_answer = $5,
             ftl_stop_seconds = $6
       WHERE id = $7 RETURNING *`,
      [req.file.size, num(req.body?.duration_seconds), lyrics, lyricsSynced, ftlAnswer, ftlStop, existing.id]
    );
    res.json(upd.rows[0]);
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
    res.status(500).json({ error: error.message });
  }
});

router.post('/csv', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  if (!req.file.originalname.endsWith('.csv')) {
    return res.status(400).json({ error: 'File must be CSV' });
  }
  res.json({
    filename: req.file.filename,
    size: req.file.size
  });
});

module.exports = router;
