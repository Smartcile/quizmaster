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
| `ADMIN_URL` | *(auto)* | Full public URL of admin dashboard (e.g. `https://admin.website.com`) |
| `SLIDESHOW_URL` | *(auto)* | Full public URL of slideshow (e.g. `https://show.website.com`) |
| `QUIZZER_URL` | *(auto)* | Full public URL of quizzer (e.g. `https://answer.website.com`) |

### Portal URLs (join links & on-screen labels)

`ADMIN_URL` / `SLIDESHOW_URL` / `QUIZZER_URL` control the join links and address labels shown on the **admin Control page** and the **slideshow lobby**. They are passed to the **backend** container and served from `GET /api/config`; the frontends fetch them at runtime (nothing is baked in at build time).

- Set the full external URL, e.g. `QUIZZER_URL=https://answer.website.com` — **no trailing slash needed** (it's stripped).
- The quizzer join link becomes a path-based deep link: `https://answer.website.com/<CODE>` (e.g. `/ABC123`), so teams land with the code pre-filled.
- If a variable is unset, the UI falls back to the current hostname on ports `3001`/`3002`/`3003`.
- **After changing these, recreate the backend container** (`docker-compose up -d`). No frontend rebuild is required.

> If your join links show `localhost:3003` (or the wrong host), it means these vars never reached the backend — make sure they're set in `.env` and your compose file is recent enough to pass them through (they live in the `backend` service `environment:` block).

### Security note

`ADMIN_PASSWORD` gates the dashboard login. `JWT_SECRET` signs the token — if someone learns the secret they can forge tokens, so use a long random string. Example: `openssl rand -hex 32`.

Write endpoints (POST/PUT/DELETE on questions/rounds/quizzes) require a valid admin token. Read endpoints stay public so slideshow and quizzer clients work without auth.

---

## Using a Domain (Cloudflare)

### Why direct Cloudflare proxy doesn't work with private IPs

Cloudflare's orange-cloud (proxied) mode routes traffic through their edge servers. Those servers **cannot reach private LAN addresses** like `192.168.1.x`. Additionally, Cloudflare only proxy-supports a [limited set of ports](https://developers.cloudflare.com/fundamentals/reference/network-ports/) (80, 443, 8080, 8443 etc.) — ports 3001/3002/3003 are not in that list, so Cloudflare will refuse to proxy them even for public IPs.

### Recommended: Cloudflare Tunnel

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared`) creates an **outbound** encrypted tunnel from your machine to Cloudflare. No router port-forwarding, no public IP, no firewall rules needed.

**One-time setup:**

1. Install `cloudflared` on the host machine (or run it as a Docker container).
2. Authenticate: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create quizmaster`
4. Create a config file `~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: admin.yourdomain.com
    service: http://localhost:3001
  - hostname: quiz.yourdomain.com
    service: http://localhost:3002
  - hostname: answer.yourdomain.com
    service: http://localhost:3003
  - service: http_status:404
```

5. Add DNS records: `cloudflared tunnel route dns quizmaster admin.yourdomain.com` (repeat for quiz and answer subdomains).
6. Run the tunnel: `cloudflared tunnel run quizmaster`

WebSockets work through Cloudflare Tunnel automatically — no extra configuration.

### Alternative: Router port-forwarding

If you have a static public IP and can configure your router:
1. Forward external port `80` → `192.168.1.100:3001` (or use 443 with SSL).
2. In Cloudflare, set the DNS record to your **public** IP and use **DNS-only** (grey cloud) mode, or enable **Full (strict) SSL** if using 443.
3. Note: only one of the three frontends can use port 80/443 this way unless you add a reverse proxy (e.g. Caddy/Traefik) in front that routes subdomains to different ports.

### Standard three-subdomain mapping (public server)

For a server with a public IP where all three ports are reachable:
- `admin.yourdomain.com` → `server:3001`
- `quiz.yourdomain.com` → `server:3002`
- `answer.yourdomain.com` → `server:3003`

API calls automatically use the same hostname the page was served from — no rebuild or reconfiguration required.

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
- Click a question to load into the right-side editor (scrollable — the Save button is always reachable); "+ New" clears
- **Dynamic MCQ options** — add as many options as you need, remove any (minimum 2 enforced)
- **📁 Import CSV** as a top-right modal button
- Media upload endpoint for image/video/audio assets

### Round Builder (drag-and-drop)
- Left palette: filterable question pool (search + category)
- Right panel: ordered drop target
- Drag from left to right to add, reorder within right, drag back to remove
- Background color picker for the round's slideshow theme

### Quiz Builder (drag-and-drop)
- Left palette: clickable round chips to add to the run-order; widget add buttons — all scrollable in fixed-height panels
- Right panel: assembled quiz run-order with compact PowerPoint-style tiles
- Each tile shows a human-readable label: round name + question count, or widget name + type
- Drag tiles to reorder — new order persists to DB on drop (`@dnd-kit`)
- **Widget Editor** modal — edit title, body text, image, background color/image for each custom slide
- Three widget types: Scoreboard, Rules, Custom Page
- **Team size handicap scoring** toggle — when enabled, teams get bonus starting points based on size (size 1 → +5 pts, up to size 10 → -4 pts). Shown as a separate "Handicap" column in History
- Existing quizzes list is scrollable; Edit and Delete buttons stack vertically within each card; Delete shows a confirmation dialog

### Session Lifecycle
- **Start Quiz** creates a session in **lobby** status — slideshow shows the big join code, teams start joining
- Teams can join during lobby phase (not just after Begin Quiz). Lobby team list **auto-refreshes** when the session transitions back to lobby after a restart
- Admin sees: live team counter, **▶ Begin Quiz** to go live
- **Active** state — Next/Previous slide nav, Lock Round Answers, slide thumbnails, quick-links to the **Quizzer Portal** and **Slideshow** portals
- Portal links appear in **both lobby and active** states. The Quizzer link is a path-based deep link (`https://answer.yourdomain.com/ABC123`) so players land with the code pre-filled; they still enter their team name before joining
- **⏸ Back to Lobby** / **↺ Restart Session** / **⏹ End Quiz** controls — End Quiz shows a confirmation dialog before finishing
- Restart keeps the same teams but resets to slide 0
- All surfaces recover automatically after a network hiccup — WebSocket auto-rejoins and the server replays authoritative state (slide index, session status, locked rounds)

### Slideshow Viewer
- Auto-detects quiz code from URL (`/quiz/CODE`, `/?code=CODE`) or shows entry screen
- **Lobby slide** with massive glowing join code, team counter, join URL
- Renders all slide types: round intro, text Q, image/video/audio Q, MCQ, answer reveal, custom widgets
- Auto-syncs with admin slide changes — no manual controls

### Quizzer Portal
- Teams enter quiz code, team name, team size
- **Waiting screen** if session is in lobby; auto-flips to playing when admin clicks Begin
- Renders the current slide as: question (with text input / MCQ / both), waiting message, or answer reveal (showing their answer, correct answer, points awarded). On reveal, the team's answer box border **glows red** when marked wrong (0) and **glows yellow** for a half mark (0.5); a correct answer (1) stays neutral
- Answers auto-save as teams type
- In-round navigation bar — jump to any unlocked question. The question the **host is currently showing** gets a distinct **amber/orange glow** (distinct from the guest's current cyan and the answered green)
- **Review before lock** — the "Mark Your Answers" slide lists all answers. Tap any question to edit it; a "← Back to Review" button returns to the list
- When a round is locked, inputs disable and the score badge appears once marked
- **Page refresh recovery** — team identity is stored in sessionStorage; refreshing the page silently rejoins the same session without re-entering the form
- Mobile-first responsive design

### Admin Dashboard (metrics + live session)
- **Live session card** at the top — pulsing dot, quiz code, current slide, "Resume Control" button
- **Neutral state** when nothing is running ("No Active Session")
- **4 metric cards**: total Questions, Rounds, Quizzes, Live Sessions
- **Bar charts**: Questions by Difficulty + Top Categories
- All quizzes list with LIVE badges on running ones
- Refresh button

### Admin Nav
| Page | Purpose |
|---|---|
| Dashboard | Start/manage sessions, live metrics |
| Questions | Question bank CRUD, import CSV, manage categories |
| Rounds | Assemble questions into rounds (scrollable panels) |
| Quizzes | Combine rounds + widgets, pick master theme, enable team size handicap |
| Masters & Slides | Edit visual themes and slide content templates |
| **Media** | Upload and manage images/video/audio; view usage labels and exact references per file |
| Control | Live slide navigation, lock/unlock, portal links (lobby + active) |
| Mark Answers | Per-team marking grid, 0 / 0.5 / 1 pt, re-click to deselect, CSV export |
| **History** | All finished sessions — dates, scores, Handicap column, CSV download |

### Answer Marking
- Lists each team's answer per question with the correct answer
- One-click 0 / 0.5 / 1 point scoring — click the **active** score button again to **deselect** and remove the mark entirely
- Real-time broadcast to all clients via WebSocket
- Download answers + scores as CSV (full session or per round)

### Live Scoreboard (per-round breakdown)
- Shows the **whole quiz structure as columns**: `Team | Starting | Round 1 | Round 2 | … | <Who Am I?/Puzzle> | Total` — round columns use the actual round names
- **Starting** column appears only when team-size handicap scoring is enabled; a **Bonus** column appears only when brownie points have been awarded. Teams are ranked by total (highest first, 🥇🥈🥉)
- Updates live as you mark answers, and is **shown on all three surfaces** — slideshow, quizzer phones, and the admin Control page
- The host controls visibility **per screen** from the Control page (three toggles: 🖥 Display / 📱 Quizzers / 👁 This screen) so results can be revealed or hidden independently. State persists across reconnects

### Quiz History
- **History** section in the admin nav shows all finished sessions
- Per-session: date/time started, team count, expandable team scoreboard (quiz pts + brownie pts + handicap pts + total), 🥇🥈🥉 ranking
- **Handicap column** appears automatically when team size scoring was enabled on the quiz
- Download the full answers CSV for any historical session

### Media Library
- **Media** section in the admin nav — upload images, video, and audio files in one place
- Responsive grid with image thumbnails and emoji icons for video/audio
- Each file shows **usage chips** (Question, Slide Master) so you know at a glance if a file is in use
- Click any file to open a detail panel with full metadata (filename, type, size, upload date, URL), a preview, and a breakdown of exactly which questions or slide masters reference it
- **Delete is blocked** while a file is still referenced — the button is greyed out with a tooltip. Safe (unused) files are deleted from disk and the database
- All uploads are registered in the `media_files` DB table so the library persists across container restarts

---

## Using a Quiz (Walkthrough)

1. **Log in** to the Admin Dashboard with `ADMIN_PASSWORD`.
2. **Media** tab (optional) → Upload any images, videos, or audio you want to use in questions or slide masters.
3. **Questions** tab → Add questions manually or import from CSV (`seed-data/example.csv` has 20 samples). Set difficulty and answer mode per question.
4. **Rounds** tab → Drag questions from the left pool into a round on the right.
5. **Quizzes** tab → Drag rounds (and add widgets) to assemble a quiz. Optionally enable **Team size handicap** scoring. Edit any widget's title/body/background before saving.
6. **Dashboard** → Click **▶ Start Session** on a quiz. Admin lands on the **Control** page.
7. Share the portal link (shown in the lobby) — it includes the quiz code so teams land with it pre-filled. They enter their team name and join.
8. When ready, click **▶ Begin Quiz** — slideshow flips from lobby to first slide.
9. Use **Next →** to advance, **🔒 Lock Round Answers** at the end of each round.
10. **Marking** tab → score answers as they come in (click an active score again to deselect it).
11. **⏹ End Quiz** when done (confirmation required), or **↺ Restart Session** to play again with the same teams.
12. **History** tab → review results, scores, and download a CSV for any finished session.

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
│   ├── sockets.js             # IO singleton (avoids circular require)
│   ├── middleware/auth.js     # JWT login + token verification
│   ├── controllers/           # Question / round / quiz / team / answer / master / slide logic
│   ├── routes/
│   ├── websocket/handlers.js  # Slide changes, answer locks, marking
│   ├── utils/                 # Code generator, seed script
│   └── Dockerfile
├── frontend-admin/            # React dashboard
│   ├── nginx.conf             # Reverse-proxies /api → backend
│   ├── src/
│   │   ├── pages/             # Login, Dashboard, QuestionManager, RoundBuilder,
│   │   │                      # QuizBuilder, QuizControl, AnswerMarking,
│   │   │                      # MastersAndSlides, MediaLibrary, QuizHistory
│   │   ├── components/        # Shared components (ImagePicker, …)
│   │   ├── services/api.js    # Token-aware HTTP client
│   │   ├── hooks/useWebSocket.js
│   │   ├── utils/buildSlides.js  # Shared slide-list logic (keep in sync!)
│   │   ├── utils/autoShrink.js   # Auto-scaling text helper
│   │   └── styles/admin.css   # Neon dark theme
│   └── Dockerfile             # Multi-stage: node build → nginx serve
├── frontend-slideshow/        # React presentation (same pattern)
├── frontend-quizzer/          # React team portal (same pattern)
└── seed-data/example.csv      # 20 sample questions for testing
```

---

## Database Schema

The `backend/schema.sql` file is idempotent and runs on every startup. New columns are added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so existing installs auto-migrate.

Key tables: `questions`, `rounds`, `round_questions`, `quizzes`, `quiz_rounds`, `quiz_widgets`, `quiz_sessions`, `teams`, `answers`, `scores`, `brownie_points`, `slide_masters`, `slides`, `categories`, `media_files`.

Notable columns:

| Table | Column | Purpose |
|---|---|---|
| `questions` | `options JSONB` | MCQ option list (dynamic, minimum 2) |
| `questions` | `difficulty` | easy / medium / hard |
| `questions` | `answer_mode` | text / mcq / both |
| `quizzes` | `team_size_scoring BOOLEAN` | enables handicap scoring per quiz |
| `quiz_sessions` | `locked_round_ids JSONB` | persisted lock state, replayed on reconnect |
| `scores` | `auto_marked BOOLEAN` | set true by auto-mark; false = manually marked; protects manual scores from auto-reset |
| `media_files` | `filename`, `url`, `mime_type`, `size_bytes` | tracks all uploaded media; checked for usage before deletion |

---

## Notes & Troubleshooting

- **Backend port not exposed**: The backend is reached internally by each frontend's nginx. Uncomment the `ports:` block under `backend` in the compose file if you need direct API access for debugging.
- **Auto-updates**: GitHub Actions rebuilds and publishes images to `ghcr.io/smartcile/quizmaster/*` on every push to `main`. Use `docker-compose -f docker-compose.prod.yml pull && up -d` to grab the latest.
- **Backups**: Media uploads (image/video/audio) are stored in the `backend_uploads` Docker volume — back this up alongside the database. File metadata is tracked in the `media_files` DB table so the library is fully restored from a DB + volume backup.
- **First-time login**: Default admin password is `admin` — change it via the `ADMIN_PASSWORD` env var before exposing the dashboard to anyone.
- **Schema migrations**: Adding new columns is safe (uses `IF NOT EXISTS`). Removing or renaming would require a manual migration.
- **WebSocket reconnection**: All three surfaces auto-rejoin their room on every `connect` event. The server responds with a `session_state` event that carries the current slide index, session status, and locked round IDs — so a brief network drop is invisible to participants.
- **Drag-and-drop library**: The admin quiz builder uses `@dnd-kit` (`@dnd-kit/core`, `@dnd-kit/sortable`). Requires `DndContext`, `SortableContext`, and `useSortable` — does not require `StrictMode` workarounds.
