const db = require('../config/database');

async function seedDatabase() {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Seed sample questions
    const questions = [
      { text: 'What is the capital of France?', answer: 'Paris', type: 'text', points: 1 },
      { text: 'What is 2 + 2?', answer: '4', type: 'text', points: 1 },
      { text: 'Which planet is nearest to the Sun?', answer: 'Mercury', type: 'text', points: 2 },
      { text: 'Who wrote Romeo and Juliet?', answer: 'William Shakespeare', type: 'text', points: 1 },
      { text: 'What is the largest ocean?', answer: 'Pacific Ocean', type: 'text', points: 1 }
    ];

    const questionIds = [];
    for (const q of questions) {
      const result = await client.query(
        'INSERT INTO questions (text, answer, type, points) VALUES ($1, $2, $3, $4) RETURNING id',
        [q.text, q.answer, q.type, q.points]
      );
      questionIds.push(result.rows[0].id);
    }

    // Seed sample round
    const roundResult = await client.query(
      'INSERT INTO rounds (name, background_color, format) VALUES ($1, $2, $3) RETURNING id',
      ['Geography & General Knowledge', '#e8f4f8', 'standard']
    );
    const roundId = roundResult.rows[0].id;

    // Add questions to round
    for (let i = 0; i < questionIds.length; i++) {
      await client.query(
        'INSERT INTO round_questions (round_id, question_id, "order") VALUES ($1, $2, $3)',
        [roundId, questionIds[i], i + 1]
      );
    }

    await client.query('COMMIT');
    console.log('Database seeded successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    client.release();
  }
}

db.initializeDatabase()
  .then(() => seedDatabase())
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Failed to seed database:', err);
    process.exit(1);
  });
