const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
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

router.post('/media', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const url = `/uploads/${req.file.filename}`;
  // Optional friendly name + virtual folder (sent by the editors / picker as
  // multipart text fields). display_name falls back to the original filename.
  const displayName = (req.body?.display_name || '').trim() || req.file.originalname;
  const folder = (req.body?.folder || '').trim() || null;
  let row = null;
  try {
    const r = await db.query(
      `INSERT INTO media_files (filename, original_name, display_name, folder, mime_type, size_bytes, url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (filename) DO NOTHING RETURNING *`,
      [req.file.filename, req.file.originalname, displayName, folder, req.file.mimetype, req.file.size, url]
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
    ...(row ? { id: row.id } : {})
  });
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
