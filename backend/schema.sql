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
ALTER TABLE questions ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20) DEFAULT 'medium';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS answer_mode VARCHAR(20) DEFAULT 'text';
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
-- locked_round_ids: JSONB array of round IDs whose answers have been locked by the admin.
-- Persisted so rejoining clients know which rounds are already locked.
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS locked_round_ids JSONB NOT NULL DEFAULT '[]';
-- scoreboard_visibility: per-surface show/hide flags for the live scoreboard,
-- toggled by the host from the Control page and broadcast to all clients.
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS scoreboard_visibility JSONB NOT NULL DEFAULT '{"slideshow":false,"quizzer":false,"admin":false}';

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

-- ============================================================
-- Slide system — masters + slides
-- Added: 2026-05-27
-- ============================================================

-- Enum: slide types
DO $$ BEGIN
  CREATE TYPE slide_type AS ENUM ('question', 'answer', 'intro', 'custom', 'widget');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enum: question_format (distinct from the legacy answer_mode column)
DO $$ BEGIN
  CREATE TYPE question_format AS ENUM ('standard', 'multichoice', 'both');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- slide_masters: defines the visual frame shared by many slides.
-- Editing a master automatically resyles every slide that references it
-- because master data is resolved at render time, never copied into slides.
--
-- styles JSONB shape:
--   { "<name>": { "fontFamily": string, "fontSize": number,
--                 "color": string, "fontWeight": string } }
--   Common names: "title", "body", "answer"
--
-- placeholders JSONB shape (array):
--   [{ "id": string, "x": number, "y": number,
--      "width": number, "height": number,
--      "styleName": string,   -- references a key in styles
--      "role": string         -- "question" | "answer" | "title"
--    }]
CREATE TABLE IF NOT EXISTS slide_masters (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  background_color     VARCHAR(7),
  background_image_url VARCHAR(500),
  styles               JSONB NOT NULL DEFAULT '{}',
  placeholders         JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);

-- slides: one record per slide in a quiz.
-- content holds ONLY slide-owned Fabric.js objects (typed text + free elements).
-- The master's background, styles, and placeholder layout are looked up via
-- master_id at render time and composited UNDER the slide content layer.
-- Master-owned data is never duplicated here.
CREATE TABLE IF NOT EXISTS slides (
  id         SERIAL PRIMARY KEY,
  quiz_id    INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  master_id  INT REFERENCES slide_masters(id) ON DELETE SET NULL,
  type       slide_type NOT NULL DEFAULT 'custom',
  "order"    INT NOT NULL,
  content    JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- questions table additions (additive — preserves all rows)
-- ============================================================

-- approved: human sign-off before a question enters a live quiz
ALTER TABLE questions ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;

-- question_format: how this question may be presented
-- 'standard'    — open text answer only
-- 'multichoice' — MCQ options only
-- 'both'        — either mode depending on round/session config
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_format question_format DEFAULT 'standard';

-- difficulty already exists as VARCHAR(20). Add a CHECK constraint to
-- formalise the allowed values without changing the column type.
DO $$ BEGIN
  ALTER TABLE questions
    ADD CONSTRAINT questions_difficulty_check
    CHECK (difficulty IN ('easy', 'medium', 'hard'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Indexes for new tables / columns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_slides_quiz_id    ON slides(quiz_id);
CREATE INDEX IF NOT EXISTS idx_slides_master_id  ON slides(master_id);
CREATE INDEX IF NOT EXISTS idx_slides_type       ON slides(type);
CREATE INDEX IF NOT EXISTS idx_slides_order      ON slides(quiz_id, "order");
CREATE INDEX IF NOT EXISTS idx_questions_approved ON questions(approved);
CREATE INDEX IF NOT EXISTS idx_questions_format   ON questions(question_format);

-- round_questions: per-question format override for 'both'-format questions.
-- Stores the mode chosen for this specific round; does not modify the source question.
ALTER TABLE round_questions ADD COLUMN IF NOT EXISTS question_format_override VARCHAR(20);

-- ============================================================
-- Categories — promoted from a derived list to a managed table
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order, name);

-- Seed a sensible default list. ON CONFLICT keeps this idempotent across
-- container restarts, and admins can rename or delete any of these later.
INSERT INTO categories (name, sort_order) VALUES
  ('General Knowledge', 10),
  ('History',           20),
  ('Geography',         30),
  ('Science',           40),
  ('Nature',            50),
  ('Music',             60),
  ('Movies',            70),
  ('TV',                80),
  ('Sport',             90),
  ('Literature',        100),
  ('Food & Drink',      110),
  ('Pop Culture',       120),
  ('Technology',        130),
  ('Art',               140)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- Masters & Slides merge — additive migrations
-- ============================================================

-- Store per-slide-type content templates inside each master.
-- Shape: { "intro": { title, subtitle }, "round_intro": { label },
--          "mark_answers": { heading, subtitle }, "end": { title, subtitle },
--          "scoreboard": { title, bgColor }, "rules": { title, body, bgColor },
--          "custom": [{ id, name, title, body, imageUrl, bgColor }, ...] }
ALTER TABLE slide_masters ADD COLUMN IF NOT EXISTS templates JSONB NOT NULL DEFAULT '{}';

-- Allow a quiz to declare which master theme it uses.
-- The QuizBuilder presents custom pages from that master as available widgets.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS master_id INT REFERENCES slide_masters(id) ON DELETE SET NULL;

-- ============================================================
-- Mixed rounds & widgets — interleaved ordering (additive)
-- ============================================================
-- position: global position of this round/widget in the quiz sequence.
-- Rounds and widgets share a single integer namespace so they can be
-- freely interleaved (e.g. Round 1 → Scoreboard → Round 2 → Scoreboard).
-- NULL means legacy row — sort those using the old per-table "order" column.
ALTER TABLE quiz_rounds  ADD COLUMN IF NOT EXISTS position INT DEFAULT NULL;
ALTER TABLE quiz_widgets ADD COLUMN IF NOT EXISTS position INT DEFAULT NULL;

-- ============================================================
-- Score tracking improvements (additive)
-- ============================================================
-- auto_marked: true when the score was set by the auto-mark system.
-- When a team changes a previously correct answer to an incorrect one,
-- the auto-mark system can reset the score to 0.
-- Manual admin marks always set auto_marked = false, preventing auto-resets.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS auto_marked BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Team size scoring (additive)
-- ============================================================
-- team_size_scoring: when enabled for a quiz, each team gets starting points
-- based on their registered size (handicap so small teams can compete).
-- Formula: GREATEST(-4, LEAST(5, 6 - size))  →  size 1→+5, 6→0, 10→-4
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS team_size_scoring BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Media library (additive)
-- ============================================================
-- media_files: tracks all uploaded files for the media library page
CREATE TABLE IF NOT EXISTS media_files (
  id            SERIAL PRIMARY KEY,
  filename      VARCHAR(500) NOT NULL UNIQUE,
  original_name VARCHAR(500),
  mime_type     VARCHAR(100),
  size_bytes    BIGINT,
  url           VARCHAR(500) NOT NULL,
  uploaded_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_files_filename ON media_files(filename);
