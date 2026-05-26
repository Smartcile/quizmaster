const db = require('../config/database');

async function getAllRounds(req, res) {
  try {
    const result = await db.query(`
      SELECT r.*, json_agg(json_build_object('id', q.id, 'text', q.text, 'type', q.type, 'answer', q.answer, 'points', q.points, 'order', rq."order")) as questions
      FROM rounds r
      LEFT JOIN round_questions rq ON r.id = rq.round_id
      LEFT JOIN questions q ON rq.question_id = q.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getRound(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query(`
      SELECT r.*, json_agg(json_build_object('id', q.id, 'text', q.text, 'type', q.type, 'answer', q.answer, 'points', q.points, 'order', rq."order")) as questions
      FROM rounds r
      LEFT JOIN round_questions rq ON r.id = rq.round_id
      LEFT JOIN questions q ON rq.question_id = q.id
      WHERE r.id = $1
      GROUP BY r.id
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createRound(req, res) {
  try {
    const { name, background_color, background_image_url, format, questions } = req.body;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const roundResult = await client.query(
        'INSERT INTO rounds (name, background_color, background_image_url, format) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, background_color, background_image_url, format]
      );
      const roundId = roundResult.rows[0].id;

      if (questions && questions.length > 0) {
        for (let i = 0; i < questions.length; i++) {
          await client.query(
            'INSERT INTO round_questions (round_id, question_id, "order") VALUES ($1, $2, $3)',
            [roundId, questions[i], i + 1]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json(roundResult.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateRound(req, res) {
  try {
    const { id } = req.params;
    const { name, background_color, background_image_url, format, questions } = req.body;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        'UPDATE rounds SET name = $1, background_color = $2, background_image_url = $3, format = $4 WHERE id = $5 RETURNING *',
        [name, background_color, background_image_url, format, id]
      );

      if (result.rows.length === 0) {
        throw new Error('Round not found');
      }

      if (questions) {
        await client.query('DELETE FROM round_questions WHERE round_id = $1', [id]);
        for (let i = 0; i < questions.length; i++) {
          await client.query(
            'INSERT INTO round_questions (round_id, question_id, "order") VALUES ($1, $2, $3)',
            [id, questions[i], i + 1]
          );
        }
      }

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteRound(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM rounds WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found' });
    }
    res.json({ message: 'Round deleted', id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllRounds,
  getRound,
  createRound,
  updateRound,
  deleteRound
};
