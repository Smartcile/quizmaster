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
         whoami_clue         ← only if the quiz has a Who Am I? (one clue per round, in order)
         round_intro
         question × N
         mark_answers        ← teams review/submit before lock
         answer × N          ← advancing here auto-locks the round
       if kind === 'widget':
         if type === 'whoami': skipped (distributed as whoami_clue slides above)
         else: widget
end                          ← reveals the Who Am I? answer if the quiz has one
```

**Who Am I?**: A quiz may carry a single `whoami` widget (`data = { title, answer, clues:[{text,points}] }`). It is *not* rendered at its drop position — `buildSlides` inserts one `whoami_clue` slide before each round's `round_intro` (round *i* → clue *i*, bounded by `min(rounds, clues.length)`), and the shared answer is revealed on the `end` slide. The `parseWhoami(items)` helper in all three `buildSlides` copies must stay in sync. See the "Who Am I?" behaviour section.

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
| `questions` | Question bank. Fields: `text`, `answer`, `type` (text/image/video/audio), `media_url`, `points`, `category`, `options` (JSONB for MCQ), `difficulty` (easy/medium/hard), `answer_mode` (text/mcq/both), `source` (local/repo/both), `is_whoami` (when true this row is a Who/What Am I? set — clues live in `options` as `[{text,points}]`, shared answer in `answer`, title in `text`; excluded from round pickers) |
| `categories` | Managed category list. Seeded with 14 defaults; admins can add/rename/delete. Renames propagate to `questions.category`. |
| `rounds` | Named question groups with optional `background_color` |
| `round_questions` | Junction: ordered questions within a round. Has `question_format_override` for per-round MCQ mode. |
| `quizzes` | Assembled quiz with a unique 6-char `code`, optional `master_id` FK to `slide_masters`, and `team_size_scoring BOOLEAN` (enables handicap scoring). |
| `quiz_rounds` | Junction: rounds within a quiz. `position` column stores global interleaved order (shared namespace with `quiz_widgets.position`). Legacy `"order"` column kept for backward compat. |
| `quiz_widgets` | Custom slides (scoreboard/rules/custom) attached to a quiz, with `data` JSONB. `position` column stores global interleaved order. |
| `quiz_sessions` | A running instance of a quiz. `status`: `lobby` → `active` → `finished`. `current_slide_index` drives sync. `locked_round_ids` JSONB array tracks which rounds' answers are locked. `scoreboard_visibility` JSONB `{slideshow,quizzer,admin}` tracks per-surface scoreboard show/hide. `is_test BOOLEAN` flags a Test Quiz run (hidden from History + the dashboard active-session lookup; deletable any time for auto-clean). `code` is the per-session rotating join code (kept on restart, preserved after end for history lookup). |
| `teams` | Teams in a session (name + size). Find-or-create by case-insensitive name enables rejoining. |
| `answers` | Team answer submissions (auto-saved on every keystroke via socket) |
| `scores` | Admin-marked scores: 0, 0.5, or 1 per question per team. Auto-populated when submitted answer matches the correct answer (normalised). `auto_marked BOOLEAN` distinguishes system marks from manual overrides. |
| `brownie_points` | Bonus points the admin can award manually |
| `slide_masters` | Visual themes: background, text styles, placeholder positions, and per-slide-type content `templates` JSONB. `is_default BOOLEAN` flags the one protected **Default Profile** (seeded on startup if none exists) — the standard theme for every quiz; it can't be deleted. |
| `slides` | Per-quiz Fabric.js canvas slides (intro/custom types) linked to a master for styling |
| `media_files` | Registry of uploaded media files. Fields: `filename` (unique), `original_name`, `mime_type`, `size_bytes`, `url`, `uploaded_at`, plus `display_name`/`folder` (virtual organisation), audio metadata `artist`/`title`/`album`/`duration_seconds`/`lyrics`/`lyrics_synced`, and `ftl_answer`/`ftl_stop_seconds` (a remembered Finish-the-Lyrics answer + cut-off for the track). Populated by `POST /api/upload/media` via `ON CONFLICT DO NOTHING`. |
| `question_repos` | Configured GitHub repos that hold question CSVs. Fields: `label`, `url`, `owner`, `repo`, `branch`, `path`, `last_synced_at`, `last_count`. Synced on demand from the Settings page. Repo-sourced questions carry `questions.repo_hash` (content fingerprint) so a re-sync can detect repo-side edits. |
| `whoami_guesses` | Per-team lock-in for a quiz's single "Who Am I?" (a quiz has no real questions row for it). Fields: `team_id` (UNIQUE), `guess_text`, `locked_clue_index`, `points_possible`, `points_awarded`, `auto_marked`, `locked`. The Who-Am-I config itself lives in a `quiz_widgets` row of `type='whoami'`. |

---

## Admin Pages

| Page | Nav label | Purpose |
|---|---|---|
| `Dashboard.jsx` | Dashboard | Start/manage sessions, live session status |
| `QuestionManager.jsx` | Questions | Question bank CRUD, category filter, difficulty, CSV export/import (duplicate-aware), category manager. A **Kind** selector morphs the editor into a **Who/What Am I?** authoring layout (numbered clues + shared answer). A **📁 Select / upload media** button opens the shared `MediaPicker`. (The legacy per-question "Format" field/filter has been removed — answer mode is set per-round in the Round builder.) |
| `RoundBuilder.jsx` | Rounds | Assemble questions into rounds, set round colour. The "Available Questions" picker in the create/edit modal filters by the same params as the Questions page — search matches **text OR answer**, plus dropdowns for category, difficulty, media type, answer mode, question format, and approval status (extra filters sit in a second `.dnd-filters-extra` row beneath search+category). |
| `QuizBuilder.jsx` | Quizzes | Combine rounds + widgets into a quiz, pick master theme, enable team size handicap scoring. The running-order panel holds rounds/widgets; a separate **bottom section** attaches one **Who/What Am I?** (gear picker, references a Question-Builder set by id — not editable here). Each saved-quiz card has a **⬇ Files** button (offline PDFs + PPTX). |
| `QuizControl.jsx` | Control | Live slide navigation, lock/unlock answers, lifecycle buttons, portal quick-links (lobby + active). In **Test Quiz** mode it also renders a "Quiz Testing" banner, embedded slideshow + quizzer preview iframes, and a bot engine (`TestHarness`). |
| `AnswerMarking.jsx` | Mark Answers | Per-question per-team answer review, 0/0.5/1 scoring with optimistic UI |
| `MastersAndSlides.jsx` | Masters & Slides | Edit master themes (Layout tab: background/styles/placeholders) and slide content defaults (Templates tab: intro/round/mark-answers/end/scoreboard/rules/custom pages). Each master card has Edit / Duplicate / **Delete** — delete is blocked (409) by `DELETE /api/masters/:id` if any quiz references the master, naming the quizzes to reassign first. The seeded **Default Profile** (★ Default badge) is the standard for every quiz: it has **no Delete button** (and the backend refuses with 409), and editing it shows a **warning** first since changes affect all quizzes using it. |
| `MediaLibrary.jsx` | Media | Upload and manage images/video/audio. Shows usage labels per file; prevents deletion of in-use files |
| `QuizHistory.jsx` | History | View all finished quiz sessions: date/time, team count, expandable team scores + CSV download per session |
| `Settings.jsx` | Settings | Collapsible settings sections (built to grow). **Question Repositories** (GitHub CSV packs) and **Quiz Control & Testing** (bot count/sizes, accuracy mix, preview layout, surfaces, quizzer-pane default, auto-clean) — the latter stored in `localStorage` via `utils/testSettings.js`. |

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
| `whoami_locked` | Server → Clients | `{ teamId, lockedClueIndex }` | A team locked in their Who Am I? guess; quizzer disables the lock-in form |
| `whoami_marked` | Server → Clients | `{ teamId, points }` | Who-Am-I score awarded/changed (auto on lock or admin override); quizzer + scoreboards + marking page update |
| `media_play` | Control → Server → Clients | `{ slideIndex, nonce }` | Host triggers a question slide's audio/video to play **on the slideshow only** (never autoplays, never on phones). The nonce lets the same slide replay. Slideshow plays its media element when slideIndex matches the current slide. |

---

## Key Behaviours

### Auto-mark
When a team submits an answer, the backend normalises both the submitted text and the stored correct answer (lowercase, trim, collapse whitespace, strip leading "the ") and inserts a score of 1 if they match — but only if no score row already exists. The admin can always override by marking manually. No page refresh needed; the socket `answer_marked` event updates all clients immediately.

**Auto-mark reset**: If a team changes a previously correct auto-marked answer to an incorrect one, `maybeAutoMark` detects this (via `scores.auto_marked = true`) and resets the score to 0. Manually-marked scores (`auto_marked = false`) are never touched by this logic.

**Auto-zero unanswered on lock**: When a round is locked (the `answer_locked` socket handler), every team that has *no answer and no score* for a question in that round gets an explicit `0` inserted (`auto_marked = true`), broadcast via `answer_marked`. This makes unanswered questions show as 0 in the marking page, scoreboard, and as a red "(no answer)" glow on the quizzer reveal — rather than silently counting as nothing.

### Mark Your Answers slide
`buildSlides` inserts a `mark_answers` slide between the last question and the first answer reveal for every round. The quizzer shows a review list of all answers in that round. Advancing past this slide (into the first `answer` slide) automatically emits `answer_locked` for the round, preventing further edits.

**Editing from review**: While the round is unlocked, quizzers can tap any question in the review list to open it for editing (renders `QuestionView` with a "← Back to Review" button). Saving auto-returns them to the review list.

### Answer lock / unlock
Admins can manually lock or unlock a round's answers at any time via the buttons in QuizControl. Lock state is persisted in `quiz_sessions.locked_round_ids` (JSONB array) so rejoining clients get the correct state from `session_state`.

### Score deselection
In AnswerMarking, clicking an already-active score button (0, 0.5, or 1) sends `points: null` to `POST /api/answers/mark`, which deletes the score row. The `answer_marked` socket event is broadcast with `points: null` so all clients remove the score immediately.

### Per-session join codes + rejoin
Each started session gets its own rotating **`quiz_sessions.code`** (generated at start, kept across restarts, **preserved after it ends** for history lookup). Joining is resolved by **`GET /api/quizzes/resolve/:code`** → `{ quiz, session }`: it matches a **session code** first (any status, so an old/finished code resolves), then falls back to the **quiz code** → that quiz's current live (lobby/active, non-test) session. The slideshow lobby + QR and the admin Control deep links display the **session** code (falling back to the quiz code until it loads); the quiz code still works as a shortcut.

`POST /api/teams/join` is a case-insensitive find-or-create matched on **session + team name only** (team size never affects identity, so a guest rejoins from any device). Existing team → `200` with `rejoined: true`; all answers/scores preserved. A **finished** session is read-only: it returns the existing team (`finished: true`) for review, or `404` if no team by that name — it never creates a ghost team.

**Resume everything**: on (re)join the quizzer loads both the team's scores (`/teams/:id/scores`) and **answers** (`GET /teams/:id/answers`) so inputs refill where they left off. Entering an **old/finished** code (with the team name) opens a **read-only review** (`ReviewScreen` → `AnswerReviewView`) of that team's answers + scores grouped by round.

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

### Scoreboard visibility toggles (reveal/hide on the scoreboard slide)
The host controls, **per surface**, whether the **scoreboard widget slide reveals scores** — there is **no** forced full-screen overlay. The three Control buttons mean: **Display** + **Quizzers** = when the show is on a scoreboard slide, reveal the scores on the big screen / quizzers (default **on**); toggle off to keep them hidden for suspense (the slide then shows a "Scores hidden — revealing shortly…" placeholder). **This screen** = the admin's own inline scoreboard panel on Control (default off, unchanged). State persists in `quiz_sessions.scoreboard_visibility` (JSONB `{slideshow,quizzer,admin}`, **defaults `{slideshow:true,quizzer:true,admin:false}`**) via `PUT /api/quizzes/sessions/:id/scoreboard-visibility`, broadcasts `scoreboard_visibility_changed`, and replays in `session_state.scoreboardVisibility`. Off a scoreboard slide nothing scoreboard-related appears. The slideshow threads the flag `SlideRenderer → WidgetSlide → ScoreboardWidget`; the quizzer renders the scoreboard inline on a scoreboard slide in `QuizParticipant` (gated by the flag; the optional "View my answers" button rides along when the quiz has a review widget with `showOnScoreboard`).

### Custom pages in Masters
Each master can store custom page templates in `slide_masters.templates.custom` (array). When a quiz is built using that master, these custom pages appear as pre-filled widget options in QuizBuilder so they can be added to the quiz order without re-typing content each time.

### Default Profile master (standard for all quizzes)
A single protected master row with `is_default = TRUE` ("Default Profile") is seeded on startup (`schema.sql`, guarded by `WHERE NOT EXISTS`). It is the **standard** theme for every quiz, replacing the old "no master" state:
- **QuizBuilder** preselects it for new quizzes and for any existing quiz whose `master_id` is null; the master dropdown no longer offers a "no master" option.
- **`loadQuizWithRoundsAndWidgets`** resolves the master via `COALESCE(q.master_id, <default id>)`, so a quiz with no stored master still renders with the Default Profile.
- **Cannot be deleted**: `deleteMaster` returns 409 for the `is_default` row, and the Masters & Slides card hides its Delete button (shows a ★ Default badge instead).
- **Edit warning**: `openMaster` shows a `confirm()` warning before opening the Default Profile, since changes affect every quiz that falls back to it.
- **Changing which master is default**: every non-default master card has a **★ Set default** button → `PUT /api/masters/:id/default`, which (in a transaction) clears `is_default` on all masters and sets it on the chosen one. So a hand-built master (e.g. "Quiz Night Default") can become the protected default; the no-delete + edit-warning rules then follow it.

### Quiz history
`GET /api/quizzes/sessions/history` returns all finished sessions (quiz name, code, date, team count). `GET /api/quizzes/sessions/:id/results` returns teams with quiz scores and brownie points, ordered by total descending. The History admin page displays these with expandable per-session scoreboards and a CSV download link.

### Portal links & join-URL labels (driven by `/api/config`)
Every surface that needs to **display** a portal address reads it from the public `GET /api/config` endpoint, which returns:

```json
{ "quizzerUrl": <QUIZZER_URL|null>, "slideshowUrl": <SLIDESHOW_URL|null>, "adminUrl": <ADMIN_URL|null> }
```

- **Admin `QuizControl.jsx`** — the "📱 Quizzer Portal" + "🖥 Display / Slideshow" buttons (shown in both lobby and active) and the lobby "Teams visit …" code use `portalConfig.quizzerUrl` / `portalConfig.slideshowUrl`. **Both** portal buttons are path-based deep links with the code baked in (`${quizzerBase}/${code}` and `${slideshowBase}/${code}`), so opening the Display link loads the slideshow already pointed at this quiz.
- **Slideshow `App.jsx`** — the lobby "Teams join at …" label uses `portalConfig.quizzerUrl`. It also renders a **join QR code** fixed in the bottom-right corner — shown only on the **lobby and the first (intro) slide**, not throughout the show — encoding the quizzer deep link `${quizzerBase}/${code}` via `qrcode.react` (`QRCodeSVG`); the slide counter is moved to the bottom-left to make room. The QR pixel size is **responsive** (`qrSizeFor()` = `clamp(54..132)` of `min(innerWidth,innerHeight)`, recomputed on resize) so it isn't oversized in a small embedded preview.

### Responsive slideshow scaling (small previews)
Slideshow typography is all in `rem`. The slideshow root sets `html { font-size: clamp(5px, 1.5vmin, 16px); }`, so every text element scales with the **surface** it renders in: a full-screen display stays at ~16px while a small embedded preview iframe (Control page) shrinks the text down to fit instead of clipping/capping at a fixed minimum. `.slide` padding is `clamp(12px, 4.2%, 60px)` for the same reason. Only `frontend-slideshow/src/styles/slideshow.css` is affected (not the admin/quizzer apps).

When an env var is unset, `/api/config` returns `null` for it and the UI falls back to `${protocol}//${hostname}:3003` (quizzer) / `:3002` (slideshow). Trailing slashes on the configured URLs are stripped before use.

**Path-based deep link**: the quizzer join link is built as `${quizzerBase}/${quiz.code}` (e.g. `https://answer.website.com/ABC123`), shown both as the admin portal button and in the admin + slideshow lobby instructions. `JoinQuiz.jsx` reads the code from the first URL **path segment** (regex `^[A-Za-z0-9]{4,8}$`, upper-cased), falling back to a legacy `?code=` query param for older links. This relies on the quizzer nginx SPA fallback (`try_files $uri $uri/ /index.html`) so any path serves the app; Vite's absolute `/assets/...` base means deep paths still load assets correctly.

**The env vars must reach the backend container.** They are wired through the `backend` service `environment:` block in both `docker-compose.yml` and `docker-compose.prod.yml` as `QUIZZER_URL: ${QUIZZER_URL:-}` etc. Setting `SLIDESHOW_URL=https://show.website.com` in `.env` flows into the container and `/api/config` then returns it. The frontends are **not** rebuilt for this — they fetch `/api/config` at runtime, so a backend recreate (`docker-compose up -d`) is enough.

### Answer-reveal score glow on quizzer
On the quizzer answer-reveal slide, the team's "Your answer" box border reflects the awarded score once marked: `0` pts → glowing **red** (`.answer-wrong`, `--neon-pink`), `0.5` pts → glowing **yellow** (`.answer-half`, `--neon-yellow`), `1` pt (full) → glowing **green** (`.answer-correct`, `--neon-green`), not-yet-marked → unchanged neutral border. The modifier class is derived from `scores[questionId]` in `QuizParticipant.jsx` and styled in `quizzer.css`. The box now also renders for unanswered questions once a score exists (auto-zero), showing "(no answer)" with the red glow.

### Who Am I?
A quiz can carry one **Who Am I? / What Am I?** element — a shared answer revealed gradually through clues, one clue shown **before each round**.

- **Authored in the Question Builder** (`QuestionManager`): the question editor has a **Kind** selector (Standard / Who-What Am I). Choosing Who/What Am I morphs the form into a reversed-MCQ layout — numbered **clues** (each with editable points, default descending high→1) with a single shared **Answer** field below. Stored as a row in `questions` with `is_whoami = true`, clues in `options` as `[{text,points}]`, the shared answer in `answer`, and the title in `text`. These are filterable in the Questions list and **excluded from RoundBuilder** pickers (they can't go in a normal round).
- **Attached in the Quiz Builder**: a dedicated **bottom section** (separate from the running-order panel) with a **gear picker** to select one Who/What Am I from the list. It is **not editable** there (edit in the Question Builder) and **not** part of the drag-order. Persisted as a `quiz_widgets` row of `type='whoami'` whose `data = { whoamiId }` references the source question.
- **Resolution**: `loadQuizWithRoundsAndWidgets` and `whoamiController.loadWhoamiForSession` hydrate the `{ whoamiId }` reference into `{ title, answer, clues }` so `buildSlides` and the lock flow work unchanged. Legacy inline configs (`data` already carrying `clues`) still resolve as-is.

- **Slides**: `buildSlides` distributes the clues — a `whoami_clue` slide before each `round_intro` (round *i* → clue *i*) — and reveals the answer on the `end` slide. The widget is never rendered at its own position. `parseWhoami(items)` must stay identical across all three `buildSlides` copies.
- **Lock-in scoring**: a team submits **one guess** via the quizzer's `whoami_clue` slide ("Lock In"). `POST /api/whoami/lock { sessionId, teamId, clueIndex, guess }` — the server looks up the clue's points from the widget config (client only sends the index), auto-marks (correct → clue points, wrong → 0), and stores it in `whoami_guesses` with `locked=true` (immutable). Earlier lock-in = more points.
- **Marking**: AnswerMarking shows a Who Am I? section per team (guess, clue locked on, override **0** / **full points** via `POST /api/whoami/mark`).
- **Scoreboard**: `getSessionScoreboard` adds `hasWhoami` + per-team `whoami_points` folded into `total`; `LiveScoreboard` (all three copies) shows a "Who Am I?" column when present. History (`getSessionResults`) likewise includes `whoami_points`.
- **Events**: `whoami_locked` (quizzer disables form) and `whoami_marked` (quizzer/scoreboards/marking update). Routes live in `routes/whoami.js` mounted **public** at `/api/whoami` (like `/api/answers`, so the quizzer can lock in without a token).

### Quiz Testing (Test Quiz mode)
A **🧪 Test Quiz** button sits beside **▶ Start Session** on the Dashboard. It starts a session with `is_test = true` and opens the Control page in test mode. The purpose is to exercise every part of a quiz (slides, scoring, glows, scoreboard, Who Am I?) without manually driving real devices.

- **Session flag**: `POST /quizzes/:id/start` accepts `{ isTest }`. Test sessions are **excluded** from `getSessionHistory` and from `getActiveSession` (so a test never shows as "LIVE" on the dashboard, and never collides with a real session for the same quiz). Because active-session lookup skips them, the embedded surfaces target the test session by **explicit id**.
- **URL params** (added to quizzer + slideshow `App.jsx`): `?session=<id>` targets a specific session bypassing the active-session lookup; the quizzer also accepts `?team=<name>&size=<n>&autojoin=1` to auto-join as a bot (used by the "mirror" pane). `getActiveSession`/sessionStorage-restore are skipped when `team` is present.
- **Control layout** (`QuizControl` with `isTest`): a "Quiz Testing" banner, a two-column `test-layout` (left = the normal controls, right = `TestHarness`), and embedded **slideshow** + **quizzer** preview iframes. The quizzer pane toggles **Mirror a bot ⇄ Interactive (you join)**. Layout/surfaces/default mode come from settings.
- **Bots** (`TestHarness`, client-side): on session start it `POST /teams/join`s each configured bot (different sizes → exercises handicap). As you advance slides it auto-answers via the existing `submit_answer` socket event using each bot's `teamId` — correct (from the quiz's stored answer) / wrong / skipped per the bot's accuracy mix, and locks in Who-Am-I guesses per a random per-bot plan. The admin browser has the correct answers because `loadQuizWithRoundsAndWidgets` includes them.
- **Settings** (`utils/testSettings.js`, localStorage): bot count/sizes, per-bot correct/wrong %, preview layout (side-by-side/stacked), surfaces to embed, default quizzer-pane mode, and **auto-clean** (default ON).
- **Auto-clean**: closing a test run sets it `finished` then `DELETE`s it (cascades teams/answers/scores/whoami). `deleteSession` allows deleting `is_test` sessions in any status; **live sessions are never auto-deleted** (must be finished first) to protect real results.
- **Dashboard test-session panel**: test sessions are excluded from `getActiveSession` (so they never show as live cards) **and** from the "Live Sessions" stat (`/questions/stats` filters `is_test = FALSE`). If auto-clean doesn't fire (e.g. the Control tab was closed abruptly), orphaned test sessions would otherwise be invisible — so the Dashboard shows a **🧪 Test Sessions** panel listing running `is_test` sessions with **Open** / **Delete** and a **Clear all** button. Backed by `GET /api/quizzes/sessions/test` and `DELETE /api/quizzes/sessions/test` (both declared before `/sessions/:sessionId`).
- **Nav grouping**: while a session is active the Control + Mark Answers nav items are wrapped in `.nav-temp-group` with a **green** border for a live session, **grey** for a test session.
- **Mirror-pane note**: the mirror quizzer reflects live scoring (green/yellow/red glows) for the bot, but since the bot's answers are submitted from the admin socket (not the iframe), the iframe won't show the bot's typed answer text. Use Interactive mode to see the full input/reveal flow.

### Answer Review plugin page + score visibility
- **Answer Review widget** (`type='review'`, added in QuizBuilder like scoreboard/rules/custom): an end-of-quiz page where each team sees **all their own answers grouped by round, with the score awarded for each** (green/yellow/red per 1/0.5/0, plus a round total). Rendered specially on the quizzer by `AnswerReviewView` in `QuizParticipant.jsx`; it's a normal widget in `buildSlides` (no buildSlides change). Drop it last in the quiz order. On the **slideshow** the review slide renders as the **scoreboard** (scores), since the review itself is per-device. A widget option **`showOnScoreboard`** adds a **"📝 View my answers"** button to the quizzer's live scoreboard that opens the team's own answers+scores in a popup (`ReviewScreen`).
- **Score visibility rule**: per-answer scores/correctness appear in exactly two places on the quizzer — the **answer-reveal slides** and the **Answer Review** plugin page. They are deliberately **hidden everywhere a team can still see the question-input view**: the locked `QuestionView` now shows only a neutral "🔒 Answer locked" badge (no score), and the `mark_answers` review never shows scores. So if the host navigates back to a question slide after locking, no score/correctness leaks.

### Media picker
A reusable **`MediaPicker`** popup (categories-modal styling) lets you browse the media library (`GET /api/media`) or upload a new file (`POST /api/upload/media`) and pick it. Wired into the **Question editor** and the **Quiz Builder widget editor** (custom image). New uploads are auto-selected and the media `type` is inferred from the file's MIME.

In the **Question editor** the media chooser only renders when the question **type** is `image`/`video`/`audio` (not for text questions). When empty it shows a styled dashed **"📁 Select / upload \<type\>"** button; once a file is chosen it shows a thumbnail (image) or icon (video/audio) + filename with **Change** / **✕ clear** buttons — never a raw path field.

### Media editing tools (Media Library)
The Media Library detail modal exposes three in-browser editors that always **save the result as a NEW file** (`POST /api/upload/media`) and leave the original untouched:
- **✂ Crop / resize** (images) — `ImageCropEditor`: aspect presets (Free, 1:1, 4:3, 16:9, A4 portrait, A4 landscape); drag the box to move, drag the corner handle to resize (ratio-locked unless Free); exports the crop at full source resolution via canvas (`image/jpeg` for JPEGs else `image/png`).
- **✂ Edit audio** (audio) — `AudioEditor`: decodes via Web Audio, draws a waveform, trim start/end (range sliders shade the canvas), fade in/out, volume slider + **Normalise** (peak→1). Preview plays the edited region through an `OfflineAudioContext` render. Export **matches the source format**: WAV stays 16-bit PCM **WAV** (`audioBufferToWav`); MP3 and any other compressed source export as **MP3** via `@breezystack/lamejs` (`audioBufferToMp3`, lazy-imported). When the track has lyrics it shows a **scrollable ~10-line karaoke panel** (synced LRC lines light up + auto-scroll, out-of-trim lines dimmed) and a **"🎤 Mark Finish-the-Lyrics answer"** tick — clicking lines highlights them **yellow** to become the question answer and auto-sets the snippet stop. The result is saved on the new clip (`ftl_answer`/`ftl_stop_seconds`) and passed back via `onSaved(data, { answer, stopSeconds })`. See the "Audio rounds" section.
- **✂ Trim video** (video) — `VideoEditor`: HTML5 preview with start/end range sliders + "set to playhead" buttons; trims via **ffmpeg.wasm** (`@ffmpeg/ffmpeg`, single-thread `@ffmpeg/core`) using a fast lossless stream copy (`-ss … -i … -t … -c copy`) that **keeps the source format/codec** (cuts snap to the nearest keyframe — no re-encode). The ~32 MB core is loaded **once per session** (cached in a module singleton) and lazily on first use.

**Audacity-style scrubbing + Overwrite save:** the audio waveform is interactive — **click to place the cursor**, **drag the orange edges** to trim, and Play starts from the cursor. The peaks are cached per buffer (a white playhead animates during preview without re-scanning the samples). When the track has timed (LRC) lyrics, a **Sync nudge** (±0.1 / ±0.5 s) shifts every timestamp live and is baked into the saved copy (`shiftLrcText`). Both the audio and video editors offer **two saves**: **💾 Save as new** (the original flow — prompts a name, creates a fresh `media_files` row) and **♻ Overwrite original** (`PUT /api/upload/media/:id` — replaces the bytes at the existing filename/url so every question/slide already using the file gets the edit instantly; only shown when the file has an `id`).

**ffmpeg.wasm core delivery (no CDN):** the `ffmpegCore()` plugin in `frontend-admin/vite.config.js` copies the UMD core + wasm to a stable served path **`/ffmpeg/ffmpeg-core.{js,wasm}`** — emitted into the production build (served by the admin nginx) and via dev middleware locally. `VideoEditor` loads them with `toBlobURL` from `import.meta.env.BASE_URL + 'ffmpeg'`, so it works offline behind any host. Single-thread core needs **no** COOP/COEP cross-origin-isolation headers. `optimizeDeps.exclude: ['@ffmpeg/ffmpeg','@ffmpeg/util']` keeps Vite from rewriting the worker paths. New admin deps: `@breezystack/lamejs`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core`.

### Repo change detection
Repo-sourced questions store a `repo_hash` (content fingerprint) on import. `POST /api/repos/:id/sync` recomputes each CSV question's hash and compares: brand-new → inserted (`source='repo'`), text already local → relabelled `both` (and baseline hash recorded), already repo/both with a **different** hash → reported in `summary.changed` (notify-only). Re-syncing with `{ apply: true }` (the Settings "Apply N updates" button) overwrites those local copies with the repo version.

### Special-character cleaning (bulletproof, everywhere)
`backend/utils/cleanText.js` (`cleanText` + `cleanOptions`) tidies smart quotes/en-em dashes/ellipsis/non-breaking spaces → plain ASCII (NFKC, accents preserved). It runs on **every** write path so special characters can't get in regardless of source: manual create/update (`questionController`), CSV/bulk import, and GitHub repo sync. Matching for de-dup is accent/punctuation-insensitive (`norm`), so a smart-quote/dash/accent variant is recognised as the **same** question, never a new one. Two reformat tools fix rows already in the bank: a **"✨ Clean characters"** button on the Questions page (`POST /api/questions/clean-special-chars` → `{ cleaned, total }`) cleans the whole bank; and a **repo re-sync** now also cleans the stored copy of any question it recognises in place (`summary.cleaned`), so old rows get fixed without being treated as different.

### Per-question answer mode (Round builder)
The legacy "Format" field is gone from the Question editor and all search filters. Per-round display is decided **only for questions whose Answer Mode is "Both"** (`isBoth(q)` = `answer_mode === 'both'` && has options). Those rows show a yellow **"🔀 T&M"** badge (in both the Available Questions and Round Order lists) **and** a two-way **Text / MCQ** toggle — there is **no "Both" option** in the round (the host must pick one). Pure-MCQ questions show a static **MCQ** badge, pure-text show **Text**, and neither is switchable. The choice is stored as `round_questions.question_format_override`; a "Both" question **always** persists an override (defaulting to `multichoice` / MCQ) so it never falls back to the removed quizzer-chooses behaviour. `loadQuizWithRoundsAndWidgets` maps the override onto the effective `answer_mode` (`standard→text`, `multichoice→mcq`, `both→both`) so the quizzer renders the chosen input style for that round.

### Embedded previews (live + test)
`PreviewPanes` (slideshow + quizzer iframes, stacked one-per-row) is shown in **Test Quiz** mode (`TestHarness`, with bots) and on **live** quizzes via a **👁 Show previews** toggle on the Control page. The quizzer pane toggles **Mirror ⇄ Interactive** and, in Mirror mode, has a **team dropdown** to watch any joined team's screen (auto-joins as that team via the quizzer `?team=` param).

### Download Quiz Files (offline fallback)
A **⬇ Files** button on each Existing Quiz card (QuizBuilder) and a **⬇ Download Quiz Files** button on the Control page open `DownloadFilesModal`, which generates downloads **client-side** (libs: `jspdf` + `jspdf-autotable` + `pptxgenjs`) from the full quiz (fetched by id so rounds → questions/answers are present). Generators live in `utils/quizFiles.js`:
- **Quizzer Answer Sheet** (PDF) — one page per round, **boxes only — the question text is never printed** (teams read questions off the screen). Numbered write-in boxes; MCQ questions get lettered tick-boxes (A/B/C…, no option text). Row height is divided across the questions so a round always fits **exactly one page**. Team name/size on page 1, a Who-Am-I guess box if present, **no answers**.
- **Questions & Answers** (PDF) — **exactly one page per round** (text auto-shrinks to fit, never overflows), correct MCQ option highlighted, bold answer line; a final Who-Am-I answer+clues page.
- **Marking Form** (PDF, landscape) — **one whole-quiz grid** via autoTable: `Team | <round name>… | Total` with **12 blank team rows**.
- **Quiz Slideshow** (PPTX, `LAYOUT_WIDE`) — one slide per `buildSlides` slide (intro/round_intro/whoami_clue/question+options/mark_answers/answer reveal/widget/end), dark theme; editable in PowerPoint/Keynote/Slides.

### Control grouped slide thumbnails
The Control page "All Slides" strip groups slides into **per-module rows** in quiz order (Intro · Who Am I? #n · each Round · each widget · End), via `groupSlidesForControl`. Each slide is a small **`MiniSlide` preview** (icon + truncated text) instead of a bare number, with the **overall slide number in the bottom-right corner** so the host can match what's on screen vs. the quizzers. Clicking a thumb still jumps to that slide; the active one is highlighted.

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

### GitHub question repositories (Settings page)
Admins can pull questions from public GitHub repos that hold CSV files (same format as Download/Import CSV). Configured in **Settings → Question Repositories** (`Settings.jsx`).
- `question_repos` rows store `{ label, url, owner, repo, branch, path }`. `repoController.parseGitHubUrl` accepts a repo URL, a `/tree|blob/<branch>/<path>` link, or a `raw.githubusercontent.com` link.
- **Sync** (`POST /api/repos/:id/sync`) resolves the config to raw CSV files (a direct `.csv` path is fetched straight from `raw.githubusercontent.com`; a folder is listed via the GitHub **contents API** and every `.csv` is fetched). No git binary — plain HTTPS `fetch` (Node 20 global). Unauthenticated, so public repos only and subject to GitHub's 60 req/hr limit.
- Import de-dupes by normalised question text: a new question is inserted with `source='repo'`; one that already exists as `source='local'` is relabelled `'both'` (shown as **L&R**); already-`repo`/`both` ones are skipped. **Nothing is duplicated** and existing local content is never overwritten.
- The `source` is shown on each question in QuestionManager via `SourceBadge` (Local / Repo / L&R), styled like the difficulty badges.
- Routes live in `routes/repos.js` mounted at `/api/repos` behind `requireAdminForWrites` (writes need a token). A bundled `question-packs/` folder at the repo root documents the CSV format and ships a sample pack.

### Team size handicap scoring
When `team_size_scoring` is enabled on a quiz (toggle in QuizBuilder), each team receives starting points based on their registered team size: size 1→+5, 2→+4, 3→+3, 4→+2, 5→+1, 6→0, 7→-1, 8→-2, 9→-3, 10→-4. Formula: `GREATEST(-4, LEAST(5, 6 - size))`. These points are included in `total` on the scoreboard and appear as a separate "Handicap" column in History when any team has a non-zero size_points value. The `team_size_scoring` boolean is stored on the `quizzes` table and flows through `loadQuizWithRoundsAndWidgets`, `getSessionScoreboard`, and `getSessionResults`.

### Portal links with quiz code pre-fill
QuizControl shows portal link buttons for both **lobby** and **active** states. The Quizzer link is a **path-based deep link** `${quizzerBase}/${quiz.code}` (e.g. `https://answer.website.com/ABC123`) so players who open the link land with the code pre-filled in the join form. `JoinQuiz.jsx` derives the code from the first URL path segment on mount (with a legacy `?code=` query-param fallback). The portal base URL is built from `QUIZZER_URL` env var (set in backend and returned by `/api/config`) or falls back to `hostname:3003`.

### Media library
`GET /api/media` returns all uploaded files from the `media_files` table, each annotated with usage labels ("Question", "Slide Master") and an `in_use` flag. `GET /api/media/:id/usage` returns the exact questions and slide masters referencing the file. `DELETE /api/media/:id` refuses (409) if the file is still in use. The upload endpoint (`POST /api/upload/media`) registers new files in `media_files` using `ON CONFLICT DO NOTHING`. The `MediaLibrary.jsx` admin page shows a grid of files with thumbnails for images and emoji icons for video/audio; clicking a card opens a detail modal with metadata, preview, and usage breakdown.

**Rename + virtual folders (display-only):** `media_files` carries `display_name` and `folder` columns (additive). The library shows `display_name || original_name || filename`; the real `filename`/`url` are **never** renamed, so questions/masters that reference a file never break. The detail modal has a **Name** + **Folder** editor (`PUT /api/media/:id`, body `{ display_name?, folder? }`); the toolbar has a folder filter (All / Unfiled / each folder), and `GET /api/media/folders` lists distinct folders. Folders are virtual organisation only. When an in-browser editor (crop/audio/video) saves, it **prompts for a name** and uploads it as `display_name` (multipart field on `POST /api/upload/media`), inheriting the source file's `folder`.

### Global settings store (`app_settings`)
A tiny key/value table for **global** admin settings (unlike the browser-local Quiz Control test settings). `GET /api/settings` → `{ key: value }` (public read so any surface can check a flag); `PUT /api/settings` upserts keys (auth). Add future global toggles here. (The `audio_rounds_enabled` key still exists for back-compat but no longer gates anything — audio round forms are always available when an audio file is the question's media.)

### Manual media playback (big screen only) + clicker navigation
Question audio/video **never autoplays and only ever sounds on the slideshow** — phones stay silent (the quizzer shows a "🔊 Listen on the main screen" note for audio and a muted, control-less `<video>` for video). On the slideshow, audio/video render **without native controls**; a `QuestionMedia` component (keyed by slide index, so it unmounts/stops when you leave the slide) plays only when a `media_play` socket signal targets the current slide, and honours the `finish_the_lyrics` `audioStop`. Audio shows a non-interactive ♪/🔊 status badge.

The host drives this from **Control**: **keyboard + USB presenter remotes work** (a `keydown` listener handles `ArrowRight`/`PageDown` = forward, `ArrowLeft`/`PageUp` = back; ignored while typing in a field; active only when the session is `active`). Forward uses a **PowerPoint-style consume**: the first forward press on an unplayed media slide **plays the media** (emits `media_play`, marks the slide played) instead of advancing; the next press advances. A **▶ Play media / ⟳ Replay media** button (shown on media slides) triggers/repeats playback explicitly. Played state lives in `playedSlides` (Set) with a `mediaNonceRef` counter.

### Audio rounds — metadata, lyrics, Name the Song / Finish the Lyrics
**Not gated** — the audio round-form selector appears in the Question editor whenever the media type is `audio` (just like the MCQ block appears for multiple choice). Three layers:
- **Metadata** — `media_files` gains `artist/title/album/duration_seconds/lyrics/lyrics_synced` plus `ftl_answer`/`ftl_stop_seconds` (a remembered Finish-the-Lyrics answer + cut-off for that track). On audio upload the backend parses ID3 tags with `music-metadata` (dynamic-imported for CJS) and stores them **in the DB** (so they survive the editor's re-encode); editable in the Media Library detail modal. The crop/audio/video editors carry the source track's metadata (and any marked FTL answer) forward on save.
- **Lyrics + answer selection** — `POST /api/media/:id/fetch-lyrics` looks up synced LRC on **LRCLIB** (free, no key) by artist+title+(duration); stored in `lyrics` with `lyrics_synced`. The **AudioEditor** renders a **scrollable ~10-line karaoke panel** (`.ae-lyrics-panel`): synced lines light up + auto-scroll while you scrub/preview, lines outside the trim `[start,end]` are dimmed. A **"🎤 Mark Finish-the-Lyrics answer"** tick makes lines clickable — selected lines highlight **yellow** (`.ae-lyric-line.is-answer`) and become the answer; the snippet stop time is auto-set to just before the first highlighted line. On save the editor stores `ftl_answer`/`ftl_stop_seconds` on the new clip **and** (when opened from the Question editor) hands `{ answer, stopSeconds }` back via `onSaved`'s second arg. The tick works the same opened from the Media Library or from the Question editor.
- **Round forms** — `questions.audio_form` (`name_the_song` | `finish_the_lyrics` | `other`) + `questions.audio_stop_seconds`, set in the Question editor (audio-only). Picking an audio file (or switching the form to `finish_the_lyrics`) **auto-imports** the track's stored `ftl_answer`/`ftl_stop_seconds` into Answer + stop time (non-destructively). A **"✂ Cut down / lyrics"** button on the selected-audio row opens the AudioEditor to trim the snippet and mark the answer in place. `loadQuizWithRoundsAndWidgets` joins `media_files` and exposes `audio_form`, `audio_stop_seconds`, `media_artist`, `media_title`; **all three `buildSlides` copies** add these to the question + answer slides (One Rule — keep identical). Quizzer (`QuizParticipant`): `name_the_song` renders two boxes (Artist + Song) stored as `"Artist — Song"`; `finish_the_lyrics`/`other` use a normal text box, and the audio element pauses at `audioStop` so the answer isn't heard. Auto-scoring is in the socket `submit_answer` handler: **name_the_song** awards ½ for artist + ½ for song (normalised exact-or-contained vs the linked track's metadata); other forms use the existing loose match (whitespace/newlines collapse, so a multi-line lyric answer matches a single-line guess). The slideshow answer reveal shows Artist — Song for name_the_song.

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

- **502s on the quizzer/slideshow after a redeploy (stale backend IP)**: each frontend's `nginx.conf` proxies to the `backend` service. nginx must **re-resolve** that hostname rather than cache its IP at startup — otherwise, when the backend container is recreated (new Docker IP on a `docker-compose up -d`/redeploy), nginx keeps dialing the **old** IP and every `/api` + `/socket.io` call returns **502 "connection refused"** while the backend itself is perfectly healthy. The fix (in all three `nginx.conf`): a `resolver 127.0.0.11 valid=10s ipv6=off;` plus a **variable** proxy target — `set $backend backend:5000; proxy_pass http://$backend$request_uri;` — which makes nginx look up the current IP per request (Docker's embedded DNS is always at `127.0.0.11`). Immediate stop-gap if it recurs before the new images are deployed: **restart the frontend containers** so they re-resolve.

- **MCQ options not showing**: Options are stored as JSONB in `questions.options`. When creating/editing questions with `answer_mode: mcq` or `answer_mode: both`, always save the options array. The QuizParticipant renders `question.options` directly.

- **Slide index out of sync**: If you change `buildSlides()` logic in one frontend but not the others, the admin and viewers will show different slides for the same index. Always update all three copies simultaneously.

- **mark_answers slide**: Every round gets a `mark_answers` slide automatically inserted between its last question and its first answer reveal. You cannot opt out per-round without changing `buildSlides`. If you add or remove this slide from one frontend, do it in all three.

- **Media uploads**: Stored in Docker volume `backend_uploads` at `/app/uploads`. Back this volume up alongside the database. Served at `/uploads/<filename>` via both the backend static middleware and the nginx proxy.

- **Schema migrations**: Only additive changes are safe (`ADD COLUMN IF NOT EXISTS`). Removing or renaming columns requires manual intervention — the schema runs on every startup.

- **Quizzer joining**: The Quizzer (and slideshow) call `GET /api/quizzes/resolve/:code` → `{ quiz, session }`, which accepts a **session code** (exact session, any status) or the **quiz code** (→ its current live session). It never starts a session — only the admin does. Team join is find-or-create by session + name; a finished session returns the existing team read-only (or 404). Legacy `by-code` + `active-session` endpoints still exist.

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
