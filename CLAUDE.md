# Quiz Master — Claude Code Guide

## What This Project Is

Real-time pub quiz platform with three browser surfaces that stay in sync via WebSockets:
- **Admin Dashboard** (`frontend-admin`, port 3001) — build questions/rounds/quizzes, control live sessions, mark answers, manage masters & slide templates
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
├── docs/
│   └── slide-data-model.md     # Schema docs for the slide/master system
├── .github/workflows/
│   └── build-and-push.yml      # CI: builds & pushes all 4 images to GHCR on push to main
├── backend/
│   ├── server.js               # Express + Socket.io entry point
│   ├── schema.sql              # Idempotent DB schema — runs on every startup
│   ├── config/database.js      # pg connection pool + schema init
│   ├── middleware/auth.js      # login(), verifyToken(), requireAdminForWrites()
│   ├── controllers/            # Business logic per domain
│   │   ├── quizController.js
│   │   ├── roundController.js
│   │   ├── questionController.js
│   │   ├── answerController.js   # includes auto-mark logic
│   │   ├── teamController.js     # includes find-or-create rejoin + scoreboard
│   │   ├── mastersController.js
│   │   ├── slidesController.js
│   │   └── categoriesController.js
│   ├── routes/                 # Express routers (quizzes, rounds, questions, teams,
│   │                           #   answers, masters, slides, categories, upload)
│   ├── websocket/handlers.js   # All Socket.io event handlers
│   └── utils/                  # codeGenerator.js, database-seed.js
├── frontend-admin/
│   ├── nginx.conf              # Reverse-proxies /api → backend:5000
│   └── src/
│       ├── App.jsx             # Auth gate, routing, sidebar nav
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Dashboard.jsx
│       │   ├── QuestionManager.jsx   # Question bank with category manager + CSV export
│       │   ├── RoundBuilder.jsx
│       │   ├── QuizBuilder.jsx       # Quiz assembly + master theme selector
│       │   ├── QuizControl.jsx       # Live session control (lobby, slides, lock/unlock)
│       │   ├── AnswerMarking.jsx     # Per-team answer review + manual scoring
│       │   └── MastersAndSlides.jsx  # Merged master editor: Layout + Slide Templates tabs
│       ├── services/api.js     # JWT-aware fetch wrapper
│       ├── hooks/useWebSocket.js
│       └── utils/buildSlides.js  ← CRITICAL — keep in sync with slideshow + quizzer
├── frontend-slideshow/
│   ├── nginx.conf
│   └── src/
│       ├── App.jsx             # Code entry → lobby → active slide rendering + scoreboard widget
│       └── utils/buildSlides.js  ← SAME function as admin
├── frontend-quizzer/
│   ├── nginx.conf
│   └── src/
│       ├── App.jsx             # Join (find-or-create rejoin) → waiting → playing → finished
│       ├── pages/JoinQuiz.jsx  # Pre-fills quiz code from ?code= URL param
│       ├── pages/QuizParticipant.jsx  # Answer input, mark-answers review, answer reveals, host-current highlight
│       └── utils/buildSlides.js  ← SAME function as admin
```

---

## The One Rule You Must Never Break

### `buildSlides(quiz)` must stay identical across all three frontends

Files:
- `frontend-admin/src/utils/buildSlides.js`
- `frontend-slideshow/src/utils/buildSlides.js`
- `frontend-quizzer/src/utils/buildSlides.js`

The WebSocket only sends a **slide index** (integer), never the slide data itself. Every app independently calls `buildSlides(quiz)` and looks up `slides[index]`. If any copy diverges — different slide order, different type names, extra slides — the apps will show different content for the same index. Copy changes to all three files simultaneously.

The slide order produced by `buildSlides` is driven by **`quiz.items`** — a unified ordered array returned by the API that can freely interleave rounds and widgets. A quiz can be structured like:

```
Round 1 → Scoreboard → Round 2 → Scoreboard → Round 3 → End
```

Each round group always expands into the same internal sequence:

```
intro
  └─ for each item in quiz.items (rounds and widgets freely mixed):
       if kind === 'round':
         round_intro
         question × N
         mark_answers        ← teams review/submit before lock
         answer × N          ← advancing here auto-locks the round
       if kind === 'widget':
         widget
end
```

**Backward compat**: Older quizzes without `quiz.items` fall back to `quiz.rounds` (all rounds first) then `quiz.widgets` (all widgets after), which matches the previous fixed ordering.

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
- All `/api/questions`, `/api/rounds`, `/api/quizzes`, `/api/masters`, `/api/categories` **write operations** (POST/PUT/DELETE) require a valid JWT
- Read operations on those endpoints, plus all of `/api/teams`, `/api/answers`, `/api/slides`, `/api/upload`, are **public** — slideshow and quizzer clients need them without auth
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
| `categories` | Managed category list. Seeded with 14 defaults; admins can add/rename/delete. Renames propagate to `questions.category`. |
| `rounds` | Named question groups with optional `background_color` |
| `round_questions` | Junction: ordered questions within a round. Has `question_format_override` for per-round MCQ mode. |
| `quizzes` | Assembled quiz with a unique 6-char `code`, optional `master_id` FK to `slide_masters`, and `team_size_scoring BOOLEAN` (enables handicap scoring). |
| `quiz_rounds` | Junction: rounds within a quiz. `position` column stores global interleaved order (shared namespace with `quiz_widgets.position`). Legacy `"order"` column kept for backward compat. |
| `quiz_widgets` | Custom slides (scoreboard/rules/custom) attached to a quiz, with `data` JSONB. `position` column stores global interleaved order. |
| `quiz_sessions` | A running instance of a quiz. `status`: `lobby` → `active` → `finished`. `current_slide_index` drives sync. `locked_round_ids` JSONB array tracks which rounds' answers are locked. `scoreboard_visibility` JSONB `{slideshow,quizzer,admin}` tracks per-surface scoreboard show/hide. |
| `teams` | Teams in a session (name + size). Find-or-create by case-insensitive name enables rejoining. |
| `answers` | Team answer submissions (auto-saved on every keystroke via socket) |
| `scores` | Admin-marked scores: 0, 0.5, or 1 per question per team. Auto-populated when submitted answer matches the correct answer (normalised). `auto_marked BOOLEAN` distinguishes system marks from manual overrides. |
| `brownie_points` | Bonus points the admin can award manually |
| `slide_masters` | Visual themes: background, text styles, placeholder positions, and per-slide-type content `templates` JSONB |
| `slides` | Per-quiz Fabric.js canvas slides (intro/custom types) linked to a master for styling |
| `media_files` | Registry of uploaded media files. Fields: `filename` (unique), `original_name`, `mime_type`, `size_bytes`, `url`, `uploaded_at`. Populated by `POST /api/upload/media` via `ON CONFLICT DO NOTHING`. |

---

## Admin Pages

| Page | Nav label | Purpose |
|---|---|---|
| `Dashboard.jsx` | Dashboard | Start/manage sessions, live session status |
| `QuestionManager.jsx` | Questions | Question bank CRUD, category filter, difficulty, CSV export/import (duplicate-aware), category manager |
| `RoundBuilder.jsx` | Rounds | Assemble questions into rounds, set round colour |
| `QuizBuilder.jsx` | Quizzes | Combine rounds + widgets into a quiz, pick master theme, enable team size handicap scoring |
| `QuizControl.jsx` | Control | Live slide navigation, lock/unlock answers, lifecycle buttons, portal quick-links (lobby + active) |
| `AnswerMarking.jsx` | Mark Answers | Per-question per-team answer review, 0/0.5/1 scoring with optimistic UI |
| `MastersAndSlides.jsx` | Masters & Slides | Edit master themes (Layout tab: background/styles/placeholders) and slide content defaults (Templates tab: intro/round/mark-answers/end/scoreboard/rules/custom pages) |
| `MediaLibrary.jsx` | Media | Upload and manage images/video/audio. Shows usage labels per file; prevents deletion of in-use files |
| `QuizHistory.jsx` | History | View all finished quiz sessions: date/time, team count, expandable team scores + CSV download per session |

---

## WebSocket Events

All clients join room `quiz-${sessionId}` after connecting. The server sends `session_state` on every join to restore authoritative state after reconnects.

| Event | Direction | Payload | Effect |
|---|---|---|---|
| `join_quiz` | Client → Server | `{ sessionId, role, teamId?, teamName? }` | Joins room; server immediately emits `session_state` back |
| `session_state` | Server → Client | `{ slideIndex, status, lockedRoundIds, scoreboardVisibility }` | Client restores full state (used on reconnect) |
| `slide_changed` | Server → Clients | `{ slideIndex }` | All viewers update their current slide |
| `session_status_changed` | Server → Clients | `{ status, currentSlideIndex }` | Lobby/active/finished state change |
| `submit_answer` | Quizzer → Server | `{ teamId, roundId, questionId, answer }` | Upsert answer in DB; triggers auto-mark if answer matches |
| `answer_locked` | Server → Clients | `{ roundId }` | Quizzer disables inputs for that round; persisted in `locked_round_ids` |
| `answer_unlocked` | Server → Clients | `{ roundId }` | Re-enables quizzer inputs for that round |
| `answer_marked` | Server → Clients | `{ teamId, questionId, points, autoMarked? }` | Quizzer shows awarded score; admin marking page updates optimistically; live scoreboards re-fetch |
| `team_joined` | Server → Room | `{ teamId, teamName, teamSize }` | Admin lobby counter increments; slideshow team count updates |
| `scoreboard_visibility_changed` | Server → Clients | `{ visibility: { slideshow, quizzer, admin } }` | Each surface shows/hides its live scoreboard. Persisted in `quiz_sessions.scoreboard_visibility` + replayed in `session_state` |

---

## Key Behaviours

### Auto-mark
When a team submits an answer, the backend normalises both the submitted text and the stored correct answer (lowercase, trim, collapse whitespace, strip leading "the ") and inserts a score of 1 if they match — but only if no score row already exists. The admin can always override by marking manually. No page refresh needed; the socket `answer_marked` event updates all clients immediately.

**Auto-mark reset**: If a team changes a previously correct auto-marked answer to an incorrect one, `maybeAutoMark` detects this (via `scores.auto_marked = true`) and resets the score to 0. Manually-marked scores (`auto_marked = false`) are never touched by this logic.

### Mark Your Answers slide
`buildSlides` inserts a `mark_answers` slide between the last question and the first answer reveal for every round. The quizzer shows a review list of all answers in that round. Advancing past this slide (into the first `answer` slide) automatically emits `answer_locked` for the round, preventing further edits.

**Editing from review**: While the round is unlocked, quizzers can tap any question in the review list to open it for editing (renders `QuestionView` with a "← Back to Review" button). Saving auto-returns them to the review list.

### Answer lock / unlock
Admins can manually lock or unlock a round's answers at any time via the buttons in QuizControl. Lock state is persisted in `quiz_sessions.locked_round_ids` (JSONB array) so rejoining clients get the correct state from `session_state`.

### Score deselection
In AnswerMarking, clicking an already-active score button (0, 0.5, or 1) sends `points: null` to `POST /api/answers/mark`, which deletes the score row. The `answer_marked` socket event is broadcast with `points: null` so all clients remove the score immediately.

### Team rejoin
`POST /api/teams/join` does a case-insensitive find-or-create: if a team with the same name already exists in the session it returns the existing record with `rejoined: true` and `200` (not `201`). All previously submitted answers and scores are preserved. The session must not be `finished` — if it is, join returns `409`.

### Lobby team list auto-refresh
When the session transitions back to `lobby` (via `session_status_changed` WebSocket event or after a restart), QuizControl reloads the team list from `GET /api/teams/session/:id` so newly joined teams appear without a manual refresh.

### Scoreboard (per-round breakdown, all surfaces)
`GET /api/teams/session/:id/scoreboard` returns a **detailed breakdown** object (not a flat array):

```json
{
  "teamSizeScoring": true,
  "hasBrownie": false,
  "rounds": [{ "id": 12, "name": "Round 1", "format": "standard" }, ...],
  "teams": [{
    "id", "name", "size",
    "size_points",                 // handicap (Starting column)
    "brownie_total",               // Bonus column (only shown if hasBrownie)
    "round_scores": { "12": 3, "15": 5 },
    "round_total", "total"         // total = size_points + brownie_total + Σ round_scores
  }]                               // sorted by total desc
}
```

Per-round attribution joins `scores → round_questions → quiz_rounds` for the session's quiz. The shared **`LiveScoreboard`** component (duplicated in all three frontends under `src/components/`) renders columns: `# | Team | [Starting] | <round name>… | [Bonus] | Total`. Starting shows only when `teamSizeScoring`; Bonus only when any brownie points exist. Round column headers use the actual round names (so a "Who Am I?" / "Puzzle" round appears as its own column). It re-fetches on `answer_marked` / `team_joined` / `answer_locked` / `answer_unlocked`.

It is rendered in three places: the slideshow **scoreboard widget slide**, a toggle-driven **full-screen overlay** on slideshow + quizzer, and an **inline panel** on the admin Control page.

### Scoreboard visibility toggles
The host controls scoreboard visibility **per surface** from the Control page (three buttons: Display / Quizzers / This screen). State is persisted in `quiz_sessions.scoreboard_visibility` (JSONB `{slideshow,quizzer,admin}`) via `PUT /api/quizzes/sessions/:id/scoreboard-visibility` (body `{ surface, visible }` or `{ visibility }`), which broadcasts `scoreboard_visibility_changed`. Each surface shows/hides its scoreboard live and restores the correct state on reconnect from `session_state.scoreboardVisibility`.

### Custom pages in Masters
Each master can store custom page templates in `slide_masters.templates.custom` (array). When a quiz is built using that master, these custom pages appear as pre-filled widget options in QuizBuilder so they can be added to the quiz order without re-typing content each time.

### Quiz history
`GET /api/quizzes/sessions/history` returns all finished sessions (quiz name, code, date, team count). `GET /api/quizzes/sessions/:id/results` returns teams with quiz scores and brownie points, ordered by total descending. The History admin page displays these with expandable per-session scoreboards and a CSV download link.

### Portal links & join-URL labels (driven by `/api/config`)
Every surface that needs to **display** a portal address reads it from the public `GET /api/config` endpoint, which returns:

```json
{ "quizzerUrl": <QUIZZER_URL|null>, "slideshowUrl": <SLIDESHOW_URL|null>, "adminUrl": <ADMIN_URL|null> }
```

- **Admin `QuizControl.jsx`** — the "📱 Quizzer Portal" + "🖥 Display / Slideshow" buttons (shown in both lobby and active) and the lobby "Teams visit …" code use `portalConfig.quizzerUrl` / `portalConfig.slideshowUrl`. **Both** portal buttons are path-based deep links with the code baked in (`${quizzerBase}/${code}` and `${slideshowBase}/${code}`), so opening the Display link loads the slideshow already pointed at this quiz.
- **Slideshow `App.jsx`** — the lobby "Teams join at …" label uses `portalConfig.quizzerUrl`. It also renders a **join QR code** fixed in the bottom-right corner (lobby + active) encoding the quizzer deep link `${quizzerBase}/${code}` via `qrcode.react` (`QRCodeSVG`); the slide counter is moved to the bottom-left to make room. The QR is hidden on the finished screen and sits behind the scoreboard overlay when that's shown.

When an env var is unset, `/api/config` returns `null` for it and the UI falls back to `${protocol}//${hostname}:3003` (quizzer) / `:3002` (slideshow). Trailing slashes on the configured URLs are stripped before use.

**Path-based deep link**: the quizzer join link is built as `${quizzerBase}/${quiz.code}` (e.g. `https://answer.website.com/ABC123`), shown both as the admin portal button and in the admin + slideshow lobby instructions. `JoinQuiz.jsx` reads the code from the first URL **path segment** (regex `^[A-Za-z0-9]{4,8}$`, upper-cased), falling back to a legacy `?code=` query param for older links. This relies on the quizzer nginx SPA fallback (`try_files $uri $uri/ /index.html`) so any path serves the app; Vite's absolute `/assets/...` base means deep paths still load assets correctly.

**The env vars must reach the backend container.** They are wired through the `backend` service `environment:` block in both `docker-compose.yml` and `docker-compose.prod.yml` as `QUIZZER_URL: ${QUIZZER_URL:-}` etc. Setting `SLIDESHOW_URL=https://show.website.com` in `.env` flows into the container and `/api/config` then returns it. The frontends are **not** rebuilt for this — they fetch `/api/config` at runtime, so a backend recreate (`docker-compose up -d`) is enough.

### Answer-reveal score glow on quizzer
On the quizzer answer-reveal slide, the team's "Your answer" box border reflects the awarded score once marked: `0` pts → glowing **red** (`.answer-wrong`, `--neon-pink`), `0.5` pts → glowing **yellow** (`.answer-half`, `--neon-yellow`), `1` pt or not-yet-marked → unchanged neutral border. The modifier class is derived from `scores[questionId]` in `QuizParticipant.jsx` and styled in `quizzer.css`.

### Host-current highlight on quizzer round-nav
The round-nav button for the question the admin is currently showing gets a `.host-current` amber/orange highlight. This is distinct from `.current` (the question the guest is viewing) and `.answered` (a question with a submitted answer).

### End Quiz confirmation
The "⏹ End Quiz" button in QuizControl shows a `confirm()` dialog before setting the session status to `finished`.

### Duplicate-question warning in Quiz Builder
QuizBuilder computes `duplicateQuestions` (a `useMemo` over `orderItems` + `allRounds`): it looks up each added round's full question list from `allRounds` by id and flags any question id that appears more than once across the quiz — whether in two different rounds **or** twice within the same round (shown as `Round 1 ×2`). An amber banner (`.quiz-dup-warning`) lists each duplicated question text and the rounds it appears in. Duplicates are **blocking**: the Create/Save button is disabled while any exist, and `handleSubmit` guards against an Enter-key submit (sets an error instead of saving).

### Dynamic MCQ options
The question editor now supports adding and removing MCQ options dynamically (minimum 2 options). Options are no longer capped at 4.

### Duplicate-aware question import (CSV + manual add)
Both CSV import and adding a brand-new question manually run through one path in `QuestionManager.jsx`:
- **CSV is parsed client-side** (`csvToQuestions` + `parseCSVRows`) — header-driven, so column order/subset is flexible; `options` is pipe-separated. The legacy `POST /api/upload/csv` route (which only stored the file and never imported) is no longer used.
- `startImport(parsed)` splits items into **new** (not in the bank) and **duplicates** (same question text, matched via `normText` — lowercase/trim/collapsed whitespace) against the already-loaded `questions`.
- New questions always pass straight through. If any duplicates exist, the **`ImportResolveModal`** opens (styled like the categories modal) listing each duplicate with **Overwrite / Ignore / Keep copy** buttons (+ Apply-to-all shortcuts). Default action is Ignore.
- On confirm, the resolved list is sent to **`POST /api/questions/import`** `{ items: [{ action, question, existingId? }] }`. Actions: `add` (insert), `overwrite` (update existingId), `copy` (insert with ` (COPY)` appended to the text), `ignore` (skip). Runs in a transaction; returns `{ added, copied, overwritten, ignored }`.
- An **`ImportSuccessModal`** (same modal styling) then lists everything added / overwritten / copied and the ignored count. Editing an existing question (with `editingId`) bypasses all this and saves directly.

### Team size handicap scoring
When `team_size_scoring` is enabled on a quiz (toggle in QuizBuilder), each team receives starting points based on their registered team size: size 1→+5, 2→+4, 3→+3, 4→+2, 5→+1, 6→0, 7→-1, 8→-2, 9→-3, 10→-4. Formula: `GREATEST(-4, LEAST(5, 6 - size))`. These points are included in `total` on the scoreboard and appear as a separate "Handicap" column in History when any team has a non-zero size_points value. The `team_size_scoring` boolean is stored on the `quizzes` table and flows through `loadQuizWithRoundsAndWidgets`, `getSessionScoreboard`, and `getSessionResults`.

### Portal links with quiz code pre-fill
QuizControl shows portal link buttons for both **lobby** and **active** states. The Quizzer link is a **path-based deep link** `${quizzerBase}/${quiz.code}` (e.g. `https://answer.website.com/ABC123`) so players who open the link land with the code pre-filled in the join form. `JoinQuiz.jsx` derives the code from the first URL path segment on mount (with a legacy `?code=` query-param fallback). The portal base URL is built from `QUIZZER_URL` env var (set in backend and returned by `/api/config`) or falls back to `hostname:3003`.

### Media library
`GET /api/media` returns all uploaded files from the `media_files` table, each annotated with usage labels ("Question", "Slide Master") and an `in_use` flag. `GET /api/media/:id/usage` returns the exact questions and slide masters referencing the file. `DELETE /api/media/:id` refuses (409) if the file is still in use. The upload endpoint (`POST /api/upload/media`) registers new files in `media_files` using `ON CONFLICT DO NOTHING`. The `MediaLibrary.jsx` admin page shows a grid of files with thumbnails for images and emoji icons for video/audio; clicking a card opens a detail modal with metadata, preview, and usage breakdown.

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
| `QUIZZER_URL` | *(auto)* | Optional: full public URL of the quizzer portal. Shown in admin lobby and slideshow lobby. Leave unset to use port-based fallback. |
| `SLIDESHOW_URL` | *(auto)* | Optional: full public URL of the slideshow. |
| `ADMIN_URL` | *(auto)* | Optional: full public URL of the admin dashboard. |

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

- **Slide index out of sync**: If you change `buildSlides()` logic in one frontend but not the others, the admin and viewers will show different slides for the same index. Always update all three copies simultaneously.

- **mark_answers slide**: Every round gets a `mark_answers` slide automatically inserted between its last question and its first answer reveal. You cannot opt out per-round without changing `buildSlides`. If you add or remove this slide from one frontend, do it in all three.

- **Media uploads**: Stored in Docker volume `backend_uploads` at `/app/uploads`. Back this volume up alongside the database. Served at `/uploads/<filename>` via both the backend static middleware and the nginx proxy.

- **Schema migrations**: Only additive changes are safe (`ADD COLUMN IF NOT EXISTS`). Removing or renaming columns requires manual intervention — the schema runs on every startup.

- **Quizzer joining**: The Quizzer calls `GET /api/quizzes/by-code/:code` to find the quiz, then `GET /api/quizzes/:id/active-session` to find the running session. It never starts a session — only the admin does. If a team name already exists in the session, the existing record is returned (rejoin path).

- **Auto-mark normalisation**: The comparison strips leading "the ", collapses whitespace, and lowercases both sides. If a question's correct answer is `"The Moon"` and a team types `"moon"`, it will auto-score 1. Admins can still override by manually marking 0 or 0.5.

- **Interleaved rounds and widgets**: `quiz_rounds.position` and `quiz_widgets.position` share a single integer namespace (0, 1, 2…) so a quiz can be ordered `Round 1 → Scoreboard → Round 2 → Scoreboard`. Both `buildSlides` and `loadQuizWithRoundsAndWidgets` use `quiz.items` (merged, sorted by position) rather than the legacy separate `quiz.rounds` / `quiz.widgets` arrays. Older rows with `position = NULL` fall back to the old per-table `"order"` column and are treated as rounds-first, then widgets.

- **Drag and drop library**: All drag-drop uses `@dnd-kit` (QuizBuilder uses `@dnd-kit/core` + `@dnd-kit/sortable`). RoundBuilder uses `@hello-pangea/dnd`. Do not mix the two libraries within the same component tree.

- **Masters & Slides nav**: The separate "Slides" and "Masters" nav items were merged into a single "Masters & Slides" page (`MastersAndSlides.jsx`). `MasterEditor.jsx` and `SlideEditor.jsx` still exist in the file system for reference but are no longer imported from `App.jsx`.

- **Categories**: The `categories` table is seeded with 14 defaults on every startup (`ON CONFLICT DO NOTHING`). Admins can rename or delete any of them via the category manager in the Questions page. Renaming a category propagates to all questions that used the old name.

- **History route ordering**: `GET /api/quizzes/sessions/history` must be declared BEFORE `GET /api/quizzes/sessions/:sessionId` in `routes/quizzes.js`, otherwise Express matches "history" as the `:sessionId` parameter.

- **Score deselect null handling**: When the admin deselects a score, `POST /api/answers/mark` receives `{ points: null }`. The backend deletes the score row and broadcasts `answer_marked` with `points: null`. Both AnswerMarking's `applyMarkLocal` and the quizzer's `onMarked` handler must handle `null` points (remove the score rather than treating it as 0).

- **Auto-mark reset requires `auto_marked` flag**: The `scores` table has an `auto_marked BOOLEAN` column. `maybeAutoMark` only resets scores where `auto_marked = true`. Manually-marked scores are always protected from auto-reset.

- **Scrollable question editor**: The question editor panel uses `.qm-editor-scrollable` which constrains height to the viewport and makes `.form` overflow-y scrollable, so the Submit button is always reachable regardless of how many MCQ options are showing.

- **Team size scoring formula**: `GREATEST(-4, LEAST(5, 6 - size))` — teams with size > 10 get clamped to -4. Teams with `size = null` default to size=6 (0 pts). Change the formula only in both `getSessionScoreboard` (teamController.js) and `getSessionResults` (quizController.js) to keep them in sync.

- **Media library N+1 queries**: `listMedia` in mediaController.js does two COUNT queries per file to build the usage labels. This is acceptable for small libraries. If the library grows large, replace with two bulk queries (one for all question media_urls, one for all slide_master background_image_urls) and annotate in-memory.

- **Portal link code pre-fill**: The code is read once on mount via a `useState` lazy initialiser in `JoinQuiz.jsx` (`codeFromUrl()` → first path segment, else `?code=`). Deep-linking to a code does not auto-submit the form — the player still enters their team name and clicks Join. This is intentional so teams don't accidentally skip the team name step. The 4–8 char alphanumeric regex on the path segment keeps it from mistaking asset/route paths for a code.

- **Scoreboard endpoint shape**: `GET /api/teams/session/:id/scoreboard` returns an **object** `{ teamSizeScoring, hasBrownie, rounds, teams }` — not the old flat array. The `LiveScoreboard` component is duplicated in all three frontends (`src/components/LiveScoreboard.jsx`); keep them in sync if you change the rendering. Per-round attribution assumes a question appears in only one round of a given quiz; if a question is shared across two rounds in the same quiz its points count in both round columns (the displayed `total` is computed as the sum of the round columns + Starting + Bonus, so columns always add up).

- **Scoreboard visibility is per-surface**: `quiz_sessions.scoreboard_visibility` is JSONB `{slideshow,quizzer,admin}`. Toggled from the Control page, persisted via `PUT /sessions/:id/scoreboard-visibility`, broadcast as `scoreboard_visibility_changed`, and replayed in `session_state`. Slideshow + quizzer render a full-screen overlay; admin renders an inline panel.

- **Wrong join addresses (localhost:port instead of the real domain)**: This happens when the `QUIZZER_URL` / `SLIDESHOW_URL` / `ADMIN_URL` env vars don't reach the **backend** container, so `GET /api/config` returns `null` and every surface falls back to `hostname:port`. The fix is that these vars are passed through the `backend` service `environment:` block in both compose files (`QUIZZER_URL: ${QUIZZER_URL:-}` …). If they were commented out, the `.env` values were silently ignored. After changing `.env`, recreate the backend (`docker-compose up -d`) — no frontend rebuild is needed because the URLs are fetched at runtime from `/api/config`, not baked in at build time. Never bake these into the frontends via `VITE_*` — it breaks host portability.

- **Rounds and quiz builder scroll heights**: `.dnd-split` has `max-height: 55vh` and `.dnd-list` / `.so-round-picker` / `.so-list` are scrollable flex children. If the panels look too short on a large display, increase the max-height in admin.css. The `.quiz-list` (Existing Quizzes) also scrolls at `max-height: 360px`.

- **Quiz Arrange removed**: The inline "Arrange" organizer panel on quiz cards was removed. Reordering is done by loading the quiz into the builder form (Edit) and dragging tiles in the "Quiz Order" panel.
