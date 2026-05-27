# Quiz Master — Claude Code Guide

## What This Project Is

Real-time pub quiz platform with three browser surfaces that stay in sync via WebSockets:
- **Admin Dashboard** (`frontend-admin`, port 3001) — build questions/rounds/quizzes, control live sessions, mark answers
- **Slideshow Viewer** (`frontend-slideshow`, port 3002) — fullscreen big-screen presentation
- **Quizzer Portal** (`frontend-quizzer`, port 3003) — mobile-friendly team answer submission

All three frontends connect to a single Express + Socket.io backend. The browser never calls the backend directly — every frontend container runs **nginx** that proxies `/api`, `/socket.io`, and `/uploads` to `backend:5000` over the internal Docker network. This means API calls use a relative path (`/api/...`) and work identically on localhost, a LAN IP, or a Cloudflare domain without any rebuild.

---

## Essential Commands

```bash
# Local dev — build from source
docker-compose up -d --build

# Production — pull pre-built GHCR images (no source needed on server)
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# Tail logs
docker-compose logs -f backend
docker-compose logs -f frontend-admin

# Restart one service after a code change (dev)
docker-compose restart frontend-admin

# Wipe everything including DB data (destructive)
docker-compose down -v

# Open a psql shell
docker-compose exec postgres psql -U quiz_user -d quiz_master

# Backup DB
docker-compose exec -T postgres pg_dump -U quiz_user quiz_master > backup-$(date +%Y%m%d).sql
```

---

## Repository Layout

```
quiz-master/
├── docker-compose.yml          # Local dev (builds from source)
├── docker-compose.prod.yml     # Production (pulls images from GHCR)
├── .env.example
├── .github/workflows/
│   └── build-and-push.yml      # CI: builds & pushes all 4 images to GHCR on push to main
├── backend/
│   ├── server.js               # Express + Socket.io entry point
│   ├── schema.sql              # Idempotent DB schema — runs on every startup
│   ├── config/database.js      # pg connection pool + schema init
│   ├── middleware/auth.js      # login(), verifyToken(), requireAdminForWrites()
│   ├── controllers/            # Business logic per domain
│   ├── routes/                 # Express routers
│   ├── websocket/handlers.js   # All Socket.io event handlers
│   └── utils/                  # codeGenerator.js, database-seed.js
├── frontend-admin/
│   ├── nginx.conf              # Reverse-proxies /api → backend:5000
│   ├── src/
│   │   ├── App.jsx             # Auth gate, routing
│   │   ├── pages/              # Login, Dashboard, QuestionManager, RoundBuilder,
│   │   │                       # QuizBuilder, QuizControl, AnswerMarking
│   │   ├── services/api.js     # JWT-aware fetch wrapper
│   │   ├── hooks/useWebSocket.js
│   │   └── utils/buildSlides.js  ← CRITICAL — keep in sync with slideshow + quizzer
├── frontend-slideshow/
│   ├── nginx.conf
│   ├── src/
│   │   ├── App.jsx             # Code entry → lobby → active slide rendering
│   │   └── utils/buildSlides.js  ← SAME function as admin
└── frontend-quizzer/
    ├── nginx.conf
    ├── src/
    │   ├── App.jsx             # Join → waiting → playing → finished
    │   ├── pages/QuizParticipant.jsx
    │   └── utils/buildSlides.js  ← SAME function as admin
```

---

## The One Rule You Must Never Break

### `buildSlides(quiz)` must stay identical across all three frontends

Files:
- `frontend-admin/src/utils/buildSlides.js`
- `frontend-slideshow/src/utils/buildSlides.js`
- `frontend-quizzer/src/utils/buildSlides.js`

The WebSocket only sends a **slide index** (integer), never the slide data itself. Every app independently calls `buildSlides(quiz)` and looks up `slides[index]`. If any copy diverges — different slide order, different type names, extra slides — the apps will show different content for the same index. Copy changes to all three files simultaneously.

The slide order is: `intro → (round_intro → questions → answers) × N rounds → widgets → end`

---

## Architecture: How the API Stays Host-Agnostic

Each frontend is a **multi-stage Docker build**: Node/Vite builds the React app, then nginx serves the static files and reverse-proxies at the container level.

```
nginx.conf (inside each frontend container):
  location /api/        → proxy_pass http://backend:5000/api/
  location /socket.io/  → proxy_pass http://backend:5000/socket.io/ (with upgrade headers)
  location /uploads/    → proxy_pass http://backend:5000/uploads/
```

The React code only ever calls `/api/questions`, `/api/quizzes/...`, etc. — no hostname, no port. This works from any URL the page is served from.

**Never add `VITE_API_URL` or any hardcoded hostname** to these frontends. It would break the portability.

---

## Authentication

- `POST /api/auth/login` — public, accepts `{ password }`, returns `{ token }`
- `GET /api/auth/verify` — public, returns `{ ok: true }` if token in `Authorization: Bearer` header is valid
- All `/api/questions`, `/api/rounds`, `/api/quizzes` **write operations** (POST/PUT/DELETE) require a valid JWT
- Read operations on those endpoints, plus all of `/api/teams`, `/api/answers`, `/api/upload`, are **public** — slideshow and quizzer clients need them without auth
- Token stored in `localStorage` under key `adminToken`
- Set `ADMIN_PASSWORD` env var to change the login password (default: `admin`)
- Set `JWT_SECRET` to a long random string in production (`openssl rand -hex 32`)

---

## Database Schema

Schema lives in `backend/schema.sql`. It is **idempotent** — runs on every container start via `config/database.js`. New columns are added with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so existing installs auto-migrate without data loss.

**Never** use `DROP COLUMN`, `RENAME COLUMN`, or `ALTER COLUMN TYPE` in schema.sql without a matching manual migration plan — it will break existing deployments.

Key tables and their purposes:

| Table | Purpose |
|---|---|
| `questions` | Question bank. Fields: `text`, `answer`, `type` (text/image/video/audio), `media_url`, `points`, `category`, `options` (JSONB for MCQ), `difficulty` (easy/medium/hard), `answer_mode` (text/mcq/both) |
| `rounds` | Named question groups with optional `background_color` |
| `round_questions` | Junction: ordered questions within a round |
| `quizzes` | Assembled quiz with a unique 6-char `code` |
| `quiz_rounds` | Junction: ordered rounds within a quiz |
| `quiz_widgets` | Custom slides (scoreboard/rules/custom) attached to a quiz, with `data` JSONB |
| `quiz_sessions` | A running instance of a quiz. `status`: `lobby` → `active` → `finished`. `current_slide_index` drives sync |
| `teams` | Teams in a session (name + size) |
| `answers` | Team answer submissions (auto-saved) |
| `scores` | Admin-marked scores: 0, 0.5, or 1 per question per team |
| `brownie_points` | Bonus points the admin can award |

---

## WebSocket Events

All clients join room `quiz-${sessionId}` after connecting.

| Event | Direction | Payload | Effect |
|---|---|---|---|
| `join_quiz` | Client → Server | `{ sessionId, role, teamId?, teamName? }` | Joins room; sends back `slide_changed` with current index |
| `slide_changed` | Server → Clients | `{ slideIndex }` | All viewers update their current slide |
| `session_status_changed` | Server → Clients | `{ status, slideIndex }` | Lobby/active/finished state change |
| `submit_answer` | Quizzer → Server | `{ teamId, roundId, questionId, answerText }` | Upsert answer in DB |
| `answer_locked` | Server → Clients | `{ roundId }` | Quizzer disables inputs for that round |
| `mark_answer` | Admin → Server | `{ teamId, questionId, points }` | Updates score, broadcasts `score_updated` |
| `score_updated` | Server → Clients | `{ teamId, questionId, points }` | Quizzer shows their awarded score |
| `team_joined` | Server → Admin | `{ teamId, teamName, teamSize }` | Admin team counter increments |

---

## CI/CD

GitHub Actions workflow: `.github/workflows/build-and-push.yml`

Triggers on push to `main`. Steps:
1. Lowercase the image prefix from `github.repository` (required — Docker registry names must be lowercase)
2. Set up Docker Buildx
3. Log in to GHCR with `GITHUB_TOKEN`
4. Build and push each of the 4 images with `context: ./backend`, `context: ./frontend-admin`, etc.

Images published to:
```
ghcr.io/smartcile/quizmaster/backend:latest
ghcr.io/smartcile/quizmaster/frontend-admin:latest
ghcr.io/smartcile/quizmaster/frontend-slideshow:latest
ghcr.io/smartcile/quizmaster/frontend-quizzer:latest
```

**If the workflow fails with download errors for action archives**, it is likely a transient GitHub CDN outage. Check https://www.githubstatus.com/ and re-run the job — no code changes needed.

---

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `DB_USER` | `quiz_user` | Postgres username |
| `DB_PASSWORD` | `quiz_password` | **Change in production** |
| `DB_NAME` | `quiz_master` | Database name |
| `ADMIN_PASSWORD` | `admin` | Admin Dashboard login — **change before public exposure** |
| `JWT_SECRET` | `change-me-in-production` | Signs JWT tokens — **must be long and random in production** |
| `NODE_ENV` | `production` | Node environment |
| `ADMIN_PORT` | `3001` | Host port for admin dashboard |
| `SLIDESHOW_PORT` | `3002` | Host port for slideshow |
| `QUIZZER_PORT` | `3003` | Host port for quizzer |

Copy `.env.example` to `.env` before running locally.

---

## Portainer Deployment

1. Stacks → Add stack → paste `docker-compose.prod.yml`
2. Add environment variables: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_PASSWORD`, `JWT_SECRET`
3. Deploy stack
4. To update: stack → Pull and redeploy

---

## Common Gotchas

- **Backend not reachable**: The backend exposes no host port by default. It is only reachable from the frontend containers via the internal `quiz-network`. Uncomment the `ports:` block in `backend:` if you need direct access for debugging.

- **MCQ options not showing**: Options are stored as JSONB in `questions.options`. When creating/editing questions with `answer_mode: mcq` or `answer_mode: both`, always save the options array. The QuizParticipant renders `question.options` directly.

- **Slide index out of sync**: If you change `buildSlides()` logic in one frontend but not the others, the admin and viewers will show different slides for the same index. Always update all three copies.

- **Media uploads**: Stored in Docker volume `backend_uploads` at `/app/uploads`. Back this volume up alongside the database. Served at `/uploads/<filename>` via both the backend static middleware and the nginx proxy.

- **Schema migrations**: Only additive changes are safe (`ADD COLUMN IF NOT EXISTS`). Removing or renaming columns requires manual intervention — the schema runs on every startup.

- **Quizzer joining**: The Quizzer calls `GET /api/quizzes/by-code/:code` to find the quiz, then `GET /api/quizzes/:id/active-session` to find the running session. It never starts a session — only the admin does.

- **Drag and drop library**: All drag-drop uses `@hello-pangea/dnd` (a maintained React 18 fork of `react-beautiful-dnd`). It requires `<DragDropContext>`, `<Droppable>`, and `<Draggable>` wrappers and does NOT support concurrent mode `StrictMode` by default.
