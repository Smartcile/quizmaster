-- Questions table
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  text VARCHAR(1000) NOT NULL,
  answer VARCHAR(1000),
  type VARCHAR(50) NOT NULL DEFAULT 'text',
  media_url VARCHAR(500),
  points INT DEFAULT 1,
  tags VARCHAR(200),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Rounds table
CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  background_color VARCHAR(7),
  background_image_url VARCHAR(500),
  format VARCHAR(50) DEFAULT 'standard',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Round questions junction table
CREATE TABLE IF NOT EXISTS round_questions (
  round_id INT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  question_id INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  "order" INT NOT NULL,
  PRIMARY KEY (round_id, question_id)
);

-- Quizzes table
CREATE TABLE IF NOT EXISTS quizzes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(6) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Quiz rounds junction table
CREATE TABLE IF NOT EXISTS quiz_rounds (
  quiz_id INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  round_id INT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  "order" INT NOT NULL,
  PRIMARY KEY (quiz_id, round_id)
);

-- Quiz widgets table
CREATE TABLE IF NOT EXISTS quiz_widgets (
  id SERIAL PRIMARY KEY,
  quiz_id INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  data JSONB DEFAULT '{}',
  "order" INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Quiz sessions table
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id SERIAL PRIMARY KEY,
  quiz_id INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  current_slide_index INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'lobby',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  quiz_session_id INT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  size INT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Answers table
CREATE TABLE IF NOT EXISTS answers (
  id SERIAL PRIMARY KEY,
  team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id INT NOT NULL REFERENCES rounds(id),
  question_id INT NOT NULL REFERENCES questions(id),
  answer_text TEXT,
  submitted_at TIMESTAMP DEFAULT NOW()
);

-- Scores table
CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_id INT NOT NULL REFERENCES questions(id),
  points_awarded DECIMAL(3, 1) DEFAULT 0,
  marked_at TIMESTAMP DEFAULT NOW()
);

-- Brownie points table
CREATE TABLE IF NOT EXISTS brownie_points (
  id SERIAL PRIMARY KEY,
  team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  label VARCHAR(255),
  points INT DEFAULT 1,
  awarded_at TIMESTAMP DEFAULT NOW()
);

-- Additive migrations for existing installs
ALTER TABLE questions ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS options JSONB DEFAULT '[]'::jsonb;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_rounds_name ON rounds(name);
CREATE INDEX IF NOT EXISTS idx_quizzes_code ON quizzes(code);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_quiz_id ON quiz_sessions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_teams_session_id ON teams(quiz_session_id);
CREATE INDEX IF NOT EXISTS idx_answers_team_id ON answers(team_id);
CREATE INDEX IF NOT EXISTS idx_scores_team_id ON scores(team_id);
CREATE INDEX IF NOT EXISTS idx_brownie_points_team_id ON brownie_points(team_id);
