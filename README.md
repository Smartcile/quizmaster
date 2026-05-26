# Quiz Master 🎯

Real-time pub quiz platform with three synchronized surfaces:
- **Admin Dashboard** — question database, drag-and-drop quiz builder, live session control, answer marking
- **Slideshow Viewer** — fullscreen presentation for the big screen, controlled by the admin in real-time
- **Quizzer Portal** — mobile-friendly answer submission for teams

All synced live via WebSockets. Themed with a neon-dark futuristic aesthetic.

---

## Quick Start (Production — no rebuild)

Pre-built images are auto-published to GitHub Container Registry on every push to `main`. Deploy with just a compose file and `.env`:

```bash
# 1. Get the compose file
mkdir -p /opt/quizmaster && cd /opt/quizmaster
curl -O https://raw.githubusercontent.com/Smartcile/quizmaster/main/docker-compose.prod.yml

# 2. Create .env (see Environment Variables section for full list)
cat > .env << 'EOF'
DB_USER=quiz_user
DB_PASSWORD=change_me_to_something_strong
DB_NAME=quiz_master
ADMIN_PASSWORD=your_strong_admin_password
JWT_SECRET=a_long_random_string_for_signing_tokens
EOF

# 3. Pull and start
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```

Then visit:
| Component | URL | Purpose |
|---|---|---|
| **Admin Dashboard** | `http://your-host:3001` | Build & control quizzes (login required) |
| **Slideshow Viewer** | `http://your-host:3002` | Big-screen presentation |
| **Quizzer Portal** | `http://your-host:3003` | Teams submit answers from phones |

These URLs work identically over `localhost`, an internal IP, or a Cloudflare-routed domain. The API is bundled inside each frontend container — no extra ports to expose.

---

## Local Development (build from source)

```bash
git clone https://github.com/Smartcile/quizmaster.git
cd quizmaster
cp .env.example .env
docker-compose up -d --build
```

Same URLs as above.

---

## Architecture

```
Browser (any host)
   │
   ├─► :3001  ─► [frontend-admin]      nginx ─► /api/* ─► [backend] ─► [postgres]
   │                                          ─► /socket.io ─► [backend]
   │
   ├─► :3002  ─► [frontend-slideshow]  nginx ─► /api/* ─► [backend]
   │
   └─► :3003  ─► [frontend-quizzer]    nginx ─► /api/* ─► [backend]
```

Each frontend container bundles **nginx** that serves the built React app and reverse-proxies `/api`, `/socket.io`, and `/uploads` to the `backend` service over the internal Docker network. The browser only ever talks to the frontend container, so the API works the same regardless of hostname.

### Services

| Service | Image | Host port | Purpose |
|---|---|---|---|
| `postgres` | postgres:15-alpine | — | Database |
| `backend` | ghcr.io/smartcile/quizmaster/backend | — (internal) | Express + Socket.io API |
| `frontend-admin` | ghcr.io/smartcile/quizmaster/frontend-admin | 3001 | Admin dashboard |
| `frontend-slideshow` | ghcr.io/smartcile/quizmaster/frontend-slideshow | 3002 | Presentation viewer |
| `frontend-quizzer` | ghcr.io/smartcile/quizmaster/frontend-quizzer | 3003 | Team answer portal |

Health checks: postgres has `pg_isready`, backend has `/api/health`. Frontends `depends_on: service_healthy` so they only start once the API is responding.

---

## Environment Variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DB_USER` | `quiz_user` | Postgres user |
| `DB_PASSWORD` | `quiz_password` | **Change this** for any deployment |
| `DB_NAME` | `quiz_master` | Database name |
| `ADMIN_PASSWORD` | `admin` | Admin Dashboard login password |
| `JWT_SECRET` | `change-me-in-production` | Signs admin auth tokens — **make this long & random** |
| `NODE_ENV` | `production` | Node mode |
| `ADMIN_PORT` | `3001` | Host port for admin dashboard (optional override) |
| `SLIDESHOW_PORT` | `3002` | Host port for slideshow viewer (optional override) |
| `QUIZZER_PORT` | `3003` | Host port for quizzer portal (optional override) |

### Security note

`ADMIN_PASSWORD` gates the dashboard login. `JWT_SECRET` signs the token — if someone learns the secret they can forge tokens, so use a long random string. Example: `openssl rand -hex 32`.

Write endpoints (POST/PUT/DELETE on questions/rounds/quizzes) require a valid admin token. Read endpoints stay public so slideshow and quizzer clients work without auth.

---

## Using a Domain (Cloudflare)

In Cloudflare, point your domain (or subdomains) at your server IP and forward a public port to one of the host ports. The application requires no extra configuration — API calls use the same host/port the page was loaded from.

Example three-subdomain mapping:
- `admin.smartcile.com:443` → `server:3001`
- `quiz.smartcile.com:443` → `server:3002`
- `answer.smartcile.com:443` → `server:3003`

Or a single domain with path-based routing — set up rules in your reverse proxy to send `/admin` → `3001`, `/quiz` → `3002`, `/answer` → `3003`.

---

## Features

### Question Database
- CRUD questions with type (text/image/video/audio), points, category, difficulty, tags
- **Difficulty levels**: easy / medium / hard with color-coded badges
- **Answer modes**:
  - `text` — free-text input only
  - `mcq` — multiple choice only
  - `both` (hybrid) — teams can pick an MCQ option OR type a free answer
- Left-column list with **🔍 search** and category/difficulty filters
- Click a question to load into the right-side editor; "+ New" clears
- **📁 Import CSV** as a top-right modal button
- Media upload endpoint for image/video/audio assets

### Round Builder (drag-and-drop)
- Left palette: filterable question pool (search + category)
- Right panel: ordered drop target
- Drag from left to right to add, reorder within right, drag back to remove
- Background color picker for the round's slideshow theme

### Quiz Builder (drag-and-drop)
- Left palette: available rounds + widget add buttons
- Right panel: assembled quiz order (rounds and widgets mixed freely)
- **Widget Editor** modal — edit title, body text, image, background color/image for each custom slide
- Three widget types: Scoreboard, Rules, Custom Page

### Session Lifecycle
- **Start Quiz** creates a session in **lobby** status — slideshow shows the big join code, teams start joining
- Admin sees: live team counter, **▶ Begin Quiz** to go live
- **Active** state — Next/Previous slide nav, Lock Round Answers, slide thumbnails
- **⏸ Back to Lobby** / **↺ Restart Session** / **⏹ End Quiz** controls
- Restart keeps the same teams but resets to slide 0

### Slideshow Viewer
- Auto-detects quiz code from URL (`/quiz/CODE`, `/?code=CODE`) or shows entry screen
- **Lobby slide** with massive glowing join code, team counter, join URL
- Renders all slide types: round intro, text Q, image/video/audio Q, MCQ, answer reveal, custom widgets
- Auto-syncs with admin slide changes — no manual controls

### Quizzer Portal
- Teams enter quiz code, team name, team size
- **Waiting screen** if session is in lobby; auto-flips to playing when admin clicks Begin
- Renders the current slide as: question (with text input / MCQ / both), waiting message, or answer reveal (showing their answer, correct answer, points awarded)
- Answers auto-save as teams type
- When a round is locked, inputs disable and the score badge appears once marked
- Mobile-first responsive design

### Admin Dashboard (metrics + live session)
- **Live session card** at the top — pulsing dot, quiz code, current slide, "Resume Control" button
- **Neutral state** when nothing is running ("No Active Session")
- **4 metric cards**: total Questions, Rounds, Quizzes, Live Sessions
- **Bar charts**: Questions by Difficulty + Top Categories
- All quizzes list with LIVE badges on running ones
- Refresh button

### Answer Marking
- Lists each team's answer per question with the correct answer
- One-click 0 / 0.5 / 1 point scoring
- Real-time broadcast to that team's portal

---

## Using a Quiz (Walkthrough)

1. **Log in** to the Admin Dashboard with `ADMIN_PASSWORD`.
2. **Questions** tab → Add questions manually or import from CSV (`seed-data/example.csv` has 20 samples). Set difficulty and answer mode per question.
3. **Rounds** tab → Drag questions from the left pool into a round on the right.
4. **Quizzes** tab → Drag rounds (and add widgets) to assemble a quiz. Edit any widget's title/body/background before saving.
5. **Dashboard** → Click **▶ Start Session** on a quiz. Admin lands on the **Control** page.
6. Share the 6-character code with teams. They visit the Quizzer Portal and join.
7. When ready, click **▶ Begin Quiz** — slideshow flips from lobby to first slide.
8. Use **Next →** to advance, **🔒 Lock Round Answers** at the end of each round.
9. **Marking** tab → score answers as they come in.
10. **⏹ End Quiz** when done, or **↺ Restart Session** to play again with the same teams.

---

## CSV Import Format

```csv
question,answer,type,points,media_url,category,difficulty,answer_mode
"What is the capital of France?",Paris,text,1,,Geography,easy,text
"Which planet is the largest?",Jupiter,text,1,,Astronomy,easy,text
"2 + 2 = ?",4,text,1,,Math,easy,text
```

| Column | Required | Notes |
|---|---|---|
| `question` | yes | Question text |
| `answer` | yes | Correct answer (for MCQ, exact text of the correct option) |
| `type` | no (defaults `text`) | `text` / `image` / `video` / `audio` |
| `points` | no (defaults 1) | Points awarded for a fully correct answer |
| `media_url` | no | URL for image/video/audio types |
| `category` | no | Free-form tag — autocompletes existing values |
| `difficulty` | no (defaults `medium`) | `easy` / `medium` / `hard` |
| `answer_mode` | no (defaults `text`) | `text` / `mcq` / `both` |

For MCQ questions, set the options through the UI after import (or send the JSON via the API).

---

## Common Commands

```bash
# View logs (any service)
docker-compose logs -f backend

# Restart a single service
docker-compose restart frontend-admin

# Update to latest pre-built images
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# Stop everything
docker-compose down

# Stop and wipe database (destructive — loses all questions/quizzes/sessions)
docker-compose down -v

# Open a psql shell
docker-compose exec postgres psql -U quiz_user -d quiz_master

# Backup database
docker-compose exec -T postgres pg_dump -U quiz_user quiz_master > backup-$(date +%Y%m%d).sql

# Restore database
cat backup.sql | docker-compose exec -T postgres psql -U quiz_user -d quiz_master
```

---

## Portainer Deployment

1. **Stacks** → **Add stack** → name it `quizmaster`
2. **Web editor** → paste contents of `docker-compose.prod.yml`
3. **Environment variables** → set:
   - `DB_USER`
   - `DB_PASSWORD` (strong!)
   - `DB_NAME`
   - `ADMIN_PASSWORD` (strong!)
   - `JWT_SECRET` (long random string)
4. **Deploy the stack**

To update later, click the stack → **Pull and redeploy**.

---

## Repository Layout

```
quizmaster/
├── docker-compose.yml         # Local dev — builds from source
├── docker-compose.prod.yml    # Production — pulls images from GHCR
├── .env.example
├── .github/workflows/         # Auto-builds & publishes images on push to main
├── backend/                   # Express + Socket.io API
│   ├── server.js
│   ├── schema.sql             # DB schema with auto-migrations
│   ├── middleware/auth.js     # JWT login + token verification
│   ├── controllers/           # Question / round / quiz / team / answer logic
│   ├── routes/
│   ├── websocket/handlers.js  # Slide changes, answer locks, marking
│   ├── utils/                 # Code generator, seed script
│   └── Dockerfile
├── frontend-admin/            # React dashboard
│   ├── nginx.conf             # Reverse-proxies /api → backend
│   ├── src/
│   │   ├── pages/             # Login, Dashboard, QuestionManager, RoundBuilder,
│   │   │                      # QuizBuilder, QuizControl, AnswerMarking
│   │   ├── components/
│   │   ├── services/api.js    # Token-aware HTTP client
│   │   ├── hooks/useWebSocket.js
│   │   ├── utils/buildSlides.js  # Shared slide-list logic
│   │   └── styles/admin.css   # Neon dark theme
│   └── Dockerfile             # Multi-stage: node build → nginx serve
├── frontend-slideshow/        # React presentation (same pattern)
├── frontend-quizzer/          # React team portal (same pattern)
└── seed-data/example.csv      # 20 sample questions for testing
```

---

## Database Schema

The `backend/schema.sql` file is idempotent and runs on every startup. New columns are added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so existing installs auto-migrate.

Key tables: `questions`, `rounds`, `round_questions`, `quizzes`, `quiz_rounds`, `quiz_widgets`, `quiz_sessions`, `teams`, `answers`, `scores`, `brownie_points`.

Recent additions to `questions`:
- `category VARCHAR(100)` — for filtering
- `options JSONB` — MCQ choices
- `difficulty VARCHAR(20)` — easy/medium/hard
- `answer_mode VARCHAR(20)` — text/mcq/both

Recent additions to `quiz_sessions`:
- `started_at TIMESTAMP` — when the session went active

---

## Notes & Troubleshooting

- **Backend port not exposed**: The backend is reached internally by each frontend's nginx. Uncomment the `ports:` block under `backend` in the compose file if you need direct API access for debugging.
- **Auto-updates**: GitHub Actions rebuilds and publishes images to `ghcr.io/smartcile/quizmaster/*` on every push to `main`. Use `docker-compose -f docker-compose.prod.yml pull && up -d` to grab the latest.
- **Backups**: Media uploads (image/video/audio for questions) are stored in the `backend_uploads` Docker volume — back this up alongside the database.
- **First-time login**: Default admin password is `admin` — change it via the `ADMIN_PASSWORD` env var before exposing the dashboard to anyone.
- **Schema migrations**: Adding new columns is safe (uses `IF NOT EXISTS`). Removing or renaming would require a manual migration.
