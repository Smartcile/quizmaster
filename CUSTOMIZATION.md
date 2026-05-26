# Quiz Master Customization Guide

Everything you can change **without rebuilding** Docker images.

---

## Quick Reference

| What | Where |
|------|-------|
| Domain name | `.env` → `DOMAIN=smartcile.com` |
| App name / branding | `config/*-config.js` files |
| Theme colors | `config/*-config.js` → `THEME` |
| API endpoint | `config/*-config.js` → `API_URL` |
| Database credentials | `.env` → `DB_USER`, `DB_PASSWORD` |
| URL routing | `caddy/Caddyfile` |
| Backend settings | `.env` |

---

## Deployment for smartcile.com

### 1. DNS Setup
Point your domain's **A record** to your server's IP:
```
smartcile.com    A    your.server.ip
www.smartcile.com    A    your.server.ip
```

### 2. Server Setup
```bash
# SSH into server
ssh user@your.server.ip

# Clone repo (or just download the compose files + config folder)
cd /opt
git clone https://github.com/Smartcile/quizmaster.git
cd quizmaster

# Create .env
cat > .env << EOF
DOMAIN=smartcile.com
DB_USER=quiz_user
DB_PASSWORD=use_a_strong_password_here
DB_NAME=quiz_master
EOF

# Customize branding (optional)
nano config/admin-config.js
nano config/slideshow-config.js
nano config/quizzer-config.js

# Open firewall ports
sudo ufw allow 80
sudo ufw allow 443

# Deploy
docker-compose -f docker-compose.public.yml pull
docker-compose -f docker-compose.public.yml up -d
```

That's it! Caddy will automatically get HTTPS certificates from Let's Encrypt within 30 seconds.

### 3. URLs (Automatic)
- **Admin**: `https://smartcile.com/admin`
- **Slideshow**: `https://smartcile.com/quiz/ABC123`
- **Quizzer Portal**: `https://smartcile.com/answer/ABC123`
- **API**: `https://smartcile.com/api` (internal)
- **Root**: `https://smartcile.com` (redirects to /admin)

---

## Customizing Branding

Edit `config/admin-config.js`:

```javascript
window.APP_CONFIG = {
  API_URL: "/api",
  APP_NAME: "My Quiz Night",        // ← App title
  APP_TAGLINE: "Win prizes!",       // ← Subtitle
  LOGO_EMOJI: "🍻",                 // ← Logo emoji

  THEME: {
    primary: "#ff6b6b",             // ← Main color
    primaryDark: "#ee5a52",
    accent: "#feca57",
    success: "#48bb78",
    danger: "#f56565",
    warning: "#ed8936",
    sidebarBg: "#2d3748"
  }
};
```

Then **restart the container** (no rebuild!):
```bash
docker-compose -f docker-compose.public.yml restart frontend-admin
```

The new branding loads immediately. Same pattern for `slideshow-config.js` and `quizzer-config.js`.

---

## Customizing URL Routes

Want `/dashboard` instead of `/admin`? Edit `caddy/Caddyfile`:

```caddyfile
# Change this block
handle /dashboard/* {
  uri strip_prefix /dashboard
  reverse_proxy frontend-admin:3001
}
handle /dashboard {
  redir /dashboard/ permanent
}
```

Then restart Caddy:
```bash
docker-compose -f docker-compose.public.yml restart caddy
```

---

## Using a Subdomain Instead

Want `admin.smartcile.com` instead of `smartcile.com/admin`?

### 1. Add DNS records
```
admin.smartcile.com    A    your.server.ip
quiz.smartcile.com     A    your.server.ip
answer.smartcile.com   A    your.server.ip
api.smartcile.com      A    your.server.ip
```

### 2. Update Caddyfile
```caddyfile
admin.smartcile.com {
  reverse_proxy frontend-admin:3001
}

quiz.smartcile.com {
  reverse_proxy frontend-slideshow:3002
}

answer.smartcile.com {
  reverse_proxy frontend-quizzer:3003
}

api.smartcile.com {
  reverse_proxy backend:5000
  handle /socket.io/* {
    reverse_proxy backend:5000
  }
}
```

### 3. Update each config file
```javascript
// config/admin-config.js, slideshow-config.js, quizzer-config.js
window.APP_CONFIG = {
  API_URL: "https://api.smartcile.com/api",
  WS_URL: "https://api.smartcile.com",
  // ...
};
```

---

## Theme Color Reference

Pick colors from [coolors.co](https://coolors.co):

| Variable | Used for |
|----------|----------|
| `primary` | Buttons, links, accents |
| `primaryDark` | Button hover state |
| `accent` | Secondary accent color |
| `success` | Correct answers, success messages |
| `danger` | Wrong answers, delete buttons |
| `warning` | Partial credit, warnings |
| `sidebarBg` | Admin sidebar background |

---

## Multiple Events on Same Server

Run multiple quiz instances on different subdomains:

```yaml
# docker-compose.yml - copy and rename for second instance
services:
  caddy-quiz1:
    # config for quiz1.smartcile.com
  caddy-quiz2:
    # config for quiz2.smartcile.com
```

Each instance gets its own database and uploads.

---

## Environment Variables

`.env` file at project root:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOMAIN` | `:80` | Your domain (smartcile.com) — `:80` = local only |
| `DB_USER` | `quiz_user` | Postgres username |
| `DB_PASSWORD` | `quiz_password` | **CHANGE THIS!** |
| `DB_NAME` | `quiz_master` | Database name |
| `NODE_ENV` | `production` | Node environment |

---

## Backup Your Quizzes

```bash
# Backup database
docker-compose -f docker-compose.public.yml exec postgres \
  pg_dump -U quiz_user quiz_master > backup-$(date +%Y%m%d).sql

# Backup uploaded media
docker run --rm -v quizmaster_backend_uploads:/data -v $(pwd):/backup \
  alpine tar czf /backup/uploads-$(date +%Y%m%d).tar.gz /data

# Schedule weekly via cron
0 3 * * 0 cd /opt/quizmaster && ./backup.sh
```

---

## Updating to Latest Version

```bash
cd /opt/quizmaster
git pull
docker-compose -f docker-compose.public.yml pull
docker-compose -f docker-compose.public.yml up -d
```

GitHub Actions auto-builds new images on every push to main, so `pull` always gets the latest.

---

## Local Development vs Production

| | Local | Production (smartcile.com) |
|---|---|---|
| Compose file | `docker-compose.yml` | `docker-compose.public.yml` |
| URL | `http://localhost:3001` | `https://smartcile.com/admin` |
| API URL | Auto-detected | `/api` (same domain) |
| HTTPS | No | Auto (Let's Encrypt) |
| Reverse proxy | None | Caddy |

---

## Troubleshooting

### "Certificate error" / HTTPS not working
- Check DNS A record points to your server
- Check ports 80 and 443 are open
- View Caddy logs: `docker-compose -f docker-compose.public.yml logs caddy`
- Let's Encrypt rate-limits — wait 1 hour between failed attempts

### "Cannot connect to API"
- Open browser DevTools → Network tab
- Look at failing request URL — should be `https://smartcile.com/api/...`
- If it's `http://localhost:5000` → check `config/admin-config.js` has `API_URL: "/api"`

### Config changes not appearing
- Hard refresh browser: **Ctrl+Shift+R** (Cmd+Shift+R on Mac)
- Restart frontend container: `docker-compose restart frontend-admin`

### WebSocket not connecting
- Check browser console for errors
- Caddy automatically supports WebSocket — no extra config needed
- Try: `wss://smartcile.com/socket.io/` should work

---

## Need help?

Read `README.md` for architecture overview or check `PRODUCTION_DEPLOYMENT.md` for image registry details.
