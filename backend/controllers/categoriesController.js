const db = require('../config/database');

// ── List all categories, ordered by sort_order then name
async function getAllCategories(req, res) {
  try {
    const result = await db.query(
      'SELECT id, name, sort_order FROM categories ORDER BY sort_order, name'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Create a new category
async function createCategory(req, res) {
  try {
    const { name, sort_order } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await db.query(
      'INSERT INTO categories (name, sort_order) VALUES ($1, $2) RETURNING *',
      [String(name).trim(), Number.isFinite(sort_order) ? sort_order : 999]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
}

// ── Rename a category. Updates `questions.category` rows so existing
// questions keep their categorisation under the new name.
async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const { name, sort_order } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const old = await client.query('SELECT name FROM categories WHERE id = $1', [id]);
      if (!old.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Category not found' });
      }
      const oldName = old.rows[0].name;

      const updated = await client.query(
        `UPDATE categories
         SET name = COALESCE($1, name),
             sort_order = COALESCE($2, sort_order)
         WHERE id = $3 RETURNING *`,
        [name ? String(name).trim() : null,
         Number.isFinite(sort_order) ? sort_order : null,
         id]
      );

      if (name && name.trim() !== oldName) {
        await client.query(
          'UPDATE questions SET category = $1 WHERE category = $2',
          [name.trim(), oldName]
        );
      }

      await client.query('COMMIT');
      res.json(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      if (err.code === '23505') {
        return res.status(409).json({ error: 'A category with that name already exists.' });
      }
      throw err;
    }
    client.release();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ── Delete a category. Questions previously in this category are NOT deleted —
// their `category` column is set to NULL so they remain in the bank.
async function deleteCategory(req, res) {
  try {
    const { id } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cat = await client.query('SELECT name FROM categories WHERE id = $1', [id]);
      if (!cat.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Category not found' });
      }

      await client.query('UPDATE questions SET category = NULL WHERE category = $1', [cat.rows[0].name]);
      await client.query('DELETE FROM categories WHERE id = $1', [id]);

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    client.release();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory
};
