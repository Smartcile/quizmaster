const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  user: process.env.DB_USER || 'quiz_user',
  password: process.env.DB_PASSWORD || 'quiz_password',
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'quiz_master'
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

async function initializeDatabase() {
  try {
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query(schema);
      console.log('Database schema initialized successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  }
}

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

async function getClient() {
  return await pool.connect();
}

module.exports = { pool, query, getClient, initializeDatabase };
