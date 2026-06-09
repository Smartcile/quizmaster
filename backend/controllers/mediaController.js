const db = require('../config/database');
const path = require('path');
const fs = require('fs');

// GET /api/media — list all media files with usage summary labels
async function listMedia(req, res) {
  try {
    const files = await db.query('SELECT * FROM media_files ORDER BY uploaded_at DESC');

    // For each file, determine where it's used
    const result = await Promise.all(files.rows.map(async (f) => {
      const [qRes, msRes] = await Promise.all([
        db.query('SELECT COUNT(*) FROM questions WHERE media_url = $1', [f.url]),
        db.query('SELECT COUNT(*) FROM slide_masters WHERE background_image_url = $1', [f.url])
      ]);
      const labels = [];
      if (parseInt(qRes.rows[0].count) > 0)  labels.push('Question');
      if (parseInt(msRes.rows[0].count) > 0)  labels.push('Slide Master');
      return { ...f, labels, in_use: labels.length > 0 };
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// GET /api/media/:id/usage — detailed usage list
async function getMediaUsage(req, res) {
  try {
    const { id } = req.params;
    const fileRes = await db.query('SELECT * FROM media_files WHERE id = $1', [id]);
    if (!fileRes.rows.length) return res.status(404).json({ error: 'File not found' });
    const file = fileRes.rows[0];

    const [questions, masters] = await Promise.all([
      db.query('SELECT id, text, category FROM questions WHERE media_url = $1', [file.url]),
      db.query('SELECT id, name FROM slide_masters WHERE background_image_url = $1', [file.url])
    ]);

    res.json({
      file,
      usage: {
        questions: questions.rows,
        slide_masters: masters.rows
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// DELETE /api/media/:id — delete file if not in use
async function deleteMedia(req, res) {
  try {
    const { id } = req.params;
    const fileRes = await db.query('SELECT * FROM media_files WHERE id = $1', [id]);
    if (!fileRes.rows.length) return res.status(404).json({ error: 'File not found' });
    const file = fileRes.rows[0];

    // Check if in use
    const [qCount, msCount] = await Promise.all([
      db.query('SELECT COUNT(*) FROM questions WHERE media_url = $1', [file.url]),
      db.query('SELECT COUNT(*) FROM slide_masters WHERE background_image_url = $1', [file.url])
    ]);
    const totalUses = parseInt(qCount.rows[0].count) + parseInt(msCount.rows[0].count);

    if (totalUses > 0) {
      return res.status(409).json({
        error: 'File is in use and cannot be deleted. Remove it from all questions and slides first.'
      });
    }

    // Delete from disk
    const diskPath = path.join(__dirname, '../uploads', file.filename);
    try { fs.unlinkSync(diskPath); } catch { /* file may already be gone */ }

    // Delete from DB
    await db.query('DELETE FROM media_files WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// GET /api/media/folders — distinct virtual folders (for filters + datalists)
async function listFolders(req, res) {
  try {
    const r = await db.query(
      "SELECT DISTINCT folder FROM media_files WHERE folder IS NOT NULL AND folder <> '' ORDER BY folder"
    );
    res.json(r.rows.map(x => x.folder));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// PATCH/PUT /api/media/:id — rename (display_name) and/or move (folder). Only
// the friendly label + virtual folder change; the file/url are never touched,
// so questions and masters that reference it keep working.
async function updateMedia(req, res) {
  try {
    const { id } = req.params;
    const { display_name, folder } = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;
    if (display_name !== undefined) {
      fields.push(`display_name = $${i++}`);
      values.push(String(display_name).trim() || null);
    }
    if (folder !== undefined) {
      fields.push(`folder = $${i++}`);
      values.push((folder == null || String(folder).trim() === '') ? null : String(folder).trim());
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(id);
    const r = await db.query(
      `UPDATE media_files SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ error: 'File not found' });
    res.json(r.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { listMedia, getMediaUsage, deleteMedia, listFolders, updateMedia };
