# Quiz Master - Production Deployment (No Rebuild)

Deploy pre-built Docker images from GitHub Container Registry - **no source code or npm rebuild needed!**

## Quick Start (5 minutes)

```bash
# 1. SSH into your server
ssh user@your-server-ip

# 2. Create app directory
mkdir -p /opt/quizmaster
cd /opt/quizmaster

# 3. Download docker-compose file
curl -O https://raw.githubusercontent.com/Smartcile/quizmaster/main/docker-compose.prod.yml

# 4. Create .env file
cat > .env << EOF
DB_USER=quiz_user
DB_PASSWORD=your_secure_password_here
DB_NAME=quiz_master
SERVER_IP=$(hostname -I | awk '{print $1}')
NODE_ENV=production
EOF

# 5. Start all services (pulls pre-built images)
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d

# 6. Wait for startup and verify
docker-compose -f docker-compose.prod.yml ps
```

## Access Your App

| Component | URL |
|-----------|-----|
| Admin Dashboard | `http://your-server-ip:3001` |
| Slideshow Viewer | `http://your-server-ip:3002` |
| Quizzer Portal | `http://your-server-ip:3003` |
| API Backend | `http://your-server-ip:5000/api` |

---

## What's Different?

### Traditional Approach (Slower)
```bash
git clone https://github.com/Smartcile/quizmaster.git
cd quizmaster
docker-compose up -d --build  # ⏳ Takes 5-10 minutes to build
```

### This Approach (Fast ⚡)
```bash
curl -O docker-compose.prod.yml
docker-compose -f docker-compose.prod.yml up -d  # ⚡ Just 1-2 minutes!
```

**No source code needed. Just pull and run!**

---

## How It Works

1. **GitHub Actions** automatically builds images when code changes
2. Images are stored in **GitHub Container Registry (GHCR)**
3. You just pull the latest images and run them
4. Updates are instant - just pull and restart

---

## Common Tasks

### Update to Latest Version
```bash
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```

### View Logs
```bash
docker-compose -f docker-compose.prod.yml logs -f backend
```

### Stop Services
```bash
docker-compose -f docker-compose.prod.yml down
```

### Restart Services
```bash
docker-compose -f docker-compose.prod.yml restart
```

### Access Database
```bash
docker-compose -f docker-compose.prod.yml exec postgres psql -U quiz_user -d quiz_master
```

---

## Portainer Integration

### Deploy in Portainer (No Rebuild)

1. **Stacks** → **Add Stack**
2. **Web Editor** → Paste this:

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${DB_USER:-quiz_user}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-quiz_password}
      POSTGRES_DB: ${DB_NAME:-quiz_master}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  backend:
    image: ghcr.io/smartcile/quizmaster/backend:latest
    environment:
      NODE_ENV: production
      PORT: 5000
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: ${DB_USER:-quiz_user}
      DB_PASSWORD: ${DB_PASSWORD:-quiz_password}
      DB_NAME: ${DB_NAME:-quiz_master}
    ports:
      - "5000:5000"
    depends_on:
      - postgres
    volumes:
      - backend_uploads:/app/uploads
    restart: unless-stopped

  frontend-admin:
    image: ghcr.io/smartcile/quizmaster/frontend-admin:latest
    ports:
      - "3001:3001"
    environment:
      VITE_API_URL: http://${SERVER_IP:-localhost}:5000/api
    restart: unless-stopped

  frontend-slideshow:
    image: ghcr.io/smartcile/quizmaster/frontend-slideshow:latest
    ports:
      - "3002:3002"
    environment:
      VITE_API_URL: http://${SERVER_IP:-localhost}:5000/api
    restart: unless-stopped

  frontend-quizzer:
    image: ghcr.io/smartcile/quizmaster/frontend-quizzer:latest
    ports:
      - "3003:3003"
    environment:
      VITE_API_URL: http://${SERVER_IP:-localhost}:5000/api
    restart: unless-stopped

volumes:
  postgres_data:
  backend_uploads:
```

3. **Set Environment Variables:**
   - `DB_USER=quiz_user`
   - `DB_PASSWORD=your_secure_password`
   - `DB_NAME=quiz_master`
   - `SERVER_IP=your.server.ip`

4. **Deploy** → All done! No build needed.

---

## Automatic Updates with GitHub Actions

Every time code is pushed to `main` branch:
1. ✅ GitHub Actions automatically builds new images
2. ✅ Images are pushed to GitHub Container Registry
3. ✅ You pull the latest with `docker-compose -f docker-compose.prod.yml pull`

No manual building needed!

---

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `DB_USER` | quiz_user | PostgreSQL user |
| `DB_PASSWORD` | quiz_password | ⚠️ **CHANGE THIS!** Use strong password |
| `DB_NAME` | quiz_master | Database name |
| `SERVER_IP` | localhost | Your server IP (required for remote access) |
| `NODE_ENV` | production | Keep as production |

---

## Image Versions

Pull specific versions instead of latest:

```yaml
backend:
  image: ghcr.io/smartcile/quizmaster/backend:v1.0.0
```

Available tags:
- `latest` - Most recent build
- `v1.0.0`, `v1.0.1`, etc. - Specific versions (when tagged in GitHub)

---

## Troubleshooting

### Images Won't Pull
```bash
# Login to GitHub Container Registry
docker login ghcr.io
# Username: your-github-username
# Password: your-github-token (not password!)
# Generate token: Settings → Developer Settings → Personal access tokens
```

### Container Not Starting
```bash
docker-compose -f docker-compose.prod.yml logs backend
# Shows error message
```

### Permission Denied Errors
```bash
# Make sure docker user has permissions
sudo usermod -aG docker $USER
newgrp docker
```

### Out of Disk Space
```bash
# Clean up old images
docker image prune -a
docker system prune -a
```

---

## Backup & Restore

### Backup Database
```bash
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U quiz_user quiz_master > backup.sql
```

### Restore Database
```bash
cat backup.sql | docker-compose -f docker-compose.prod.yml exec -T postgres psql -U quiz_user quiz_master
```

### Backup Everything
```bash
tar -czf quiz-master-backup.tar.gz \
  $(docker volume inspect --format '{{ .Mountpoint }}' quizmaster_postgres_data) \
  $(docker volume inspect --format '{{ .Mountpoint }}' quizmaster_backend_uploads)
```

---

## Scaling Notes

If you need to run multiple instances:

```bash
# Run with custom names
docker-compose -f docker-compose.prod.yml -p quiz1 up -d
docker-compose -f docker-compose.prod.yml -p quiz2 up -d

# They share the same database but run separately
```

---

## Security Best Practices

1. ✅ Change `DB_PASSWORD` to strong password
2. ✅ Use HTTPS (add reverse proxy like Nginx)
3. ✅ Don't expose port 5432 (database) to internet
4. ✅ Keep images updated regularly
5. ✅ Use firewall to restrict port access
6. ✅ Backup database regularly

---

## What to Do After Deployment

1. Go to Admin Dashboard: `http://your-server-ip:3001`
2. Create questions and quizzes
3. Start a quiz and share code with teams
4. Teams join at Quizzer Portal: `http://your-server-ip:3003`
5. Control presentation from Slideshow Viewer: `http://your-server-ip:3002`

Enjoy your Quiz Master! 🎉

---

## Support

- View logs: `docker-compose -f docker-compose.prod.yml logs -f`
- Check images: `docker images | grep quizmaster`
- Monitor containers: `docker ps`
- Read original docs: `README.md`
