# Quiz Master 🎯

Real-time pub quiz application — admin dashboard, slideshow viewer for projection, and mobile-friendly answer portal for teams. All synchronized live via WebSockets.

---

## Quick Start (Production — no rebuild)

Pre-built images are auto-published to GitHub Container Registry on every push to `main`. Use these on any Docker host:

```bash
# 1. Get the compose file
mkdir -p /opt/quizmaster && cd /opt/quizmaster
curl -O https://raw.githubusercontent.com/Smartcile/quizmaster/main/docker-compose.prod.yml

# 2. Create .env
cat > .env << 'EOF'
DB_USER=quiz_user
DB_PASSWORD=change_me_to_something_strong
DB_NAME=quiz_master
EOF

# 3. Pull and start
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```

Then visit:
- **Admin Dashboard**: `http://your-host:3001`
- **Slideshow Viewer**: `http://your-host:3002`
- **Quizzer Portal**: `http://your-host:3003`

These URLs work identically over `localhost`, an internal IP (e.g. `192.168.1.100`), or a domain you've routed through Cloudflare. The API is bundled inside each frontend container — no extra ports to expose.

---

## Local Development (build from source)

Edit code locally and rebuild containers:

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

---

## Environment Variables (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `DB_USER` | `quiz_user` | Postgres user |
| `DB_PASSWORD` | `quiz_password` | **Change this** for any deployment |
| `DB_NAME` | `quiz_master` | Database name |
| `NODE_ENV` | `production` | Node mode |
| `ADMIN_PORT` | `3001` | Host port for admin dashboard |
| `SLIDESHOW_PORT` | `3002` | Host port for slideshow viewer |
| `QUIZZER_PORT` | `3003` | Host port for quizzer portal |

---

## Using a Domain (Cloudflare)

In Cloudflare, point your domain (or a subdomain) at your server IP. Forward your chosen public port to one of the host ports (e.g. 443 → 3001 for the admin dashboard). The application requires no extra configuration — the API call uses the same host/port the page was loaded from.

Example mapping:
- `admin.smartcile.com` → server:3001
- `quiz.smartcile.com` → server:3002
- `answer.smartcile.com` → server:3003

---

## Using a Quiz

1. **Admin Dashboard** → Questions tab: add questions manually or import from CSV (`seed-data/example.csv` has 20 samples).
2. **Rounds** tab: group questions into named rounds.
3. **Quizzes** tab: assemble rounds into a quiz. A 6-character code is generated.
4. **Dashboard** → Click "Start Quiz" to begin a session.
5. **Control** tab: advance/rewind slides; lock answers between rounds.
6. **Marking** tab: review team answers and award 0 / 0.5 / 1 points.

Teams join at `http://your-host:3003`, enter the quiz code, then submit answers as the slideshow advances.

---

## Common commands

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

# Stop and wipe database (destructive)
docker-compose down -v

# Open a psql shell
docker-compose exec postgres psql -U quiz_user -d quiz_master

# Backup database
docker-compose exec -T postgres pg_dump -U quiz_user quiz_master > backup.sql
```

---

## Portainer deployment

1. **Stacks** → **Add stack** → name it `quizmaster`
2. **Web editor** → paste contents of `docker-compose.prod.yml`
3. **Environment variables** → set `DB_USER`, `DB_PASSWORD`, `DB_NAME`
4. **Deploy the stack**

To update later, click the stack → **Pull and redeploy**.

---

## Repository layout

```
quizmaster/
├── docker-compose.yml         # Local dev (builds from source)
├── docker-compose.prod.yml    # Production (pre-built images from GHCR)
├── .env.example
├── .github/workflows/         # Auto-builds images on push to main
├── backend/                   # Express + Socket.io API
├── frontend-admin/            # React dashboard (+ nginx in container)
├── frontend-slideshow/        # React slideshow (+ nginx)
├── frontend-quizzer/          # React quizzer portal (+ nginx)
└── seed-data/example.csv      # Sample questions
```

---

## Notes

- The backend is **not** exposed on the host by default — it's reached internally by each frontend's nginx. Uncomment the `ports:` block under `backend` in the compose file if you need direct API access for debugging.
- GitHub Actions automatically rebuilds and publishes images to `ghcr.io/smartcile/quizmaster/*` on every push to `main`. Use `docker-compose -f docker-compose.prod.yml pull` to grab the latest.
- Media uploads (images/video/audio for questions) are stored in the `backend_uploads` Docker volume — back this up alongside the database.
