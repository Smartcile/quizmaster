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
  try {
    await db.query(
      `INSERT INTO media_files (filename, original_name, mime_type, size_bytes, url)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (filename) DO NOTHING`,
      [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url]
    );
  } catch { /* non-fatal — media library tracking is best-effort */ }
  res.json({
    filename: req.file.filename,
    url,
    size: req.file.size
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
