# Quiz Master - Portainer Deployment Guide

Deploy Quiz Master on your Linux server using Portainer (Docker Web UI).

## Prerequisites

- Docker and Docker Compose installed on Linux server
- Portainer running (typically at `http://your-server:9000`)
- Git clone of this repo, OR the docker-compose.portainer.yml file

## Step 1: Prepare Your Server

SSH into your server and clone the repository:

```bash
cd /opt
git clone https://github.com/Smartcile/quizmaster.git
cd quizmaster
```

Or if using an existing directory, just make sure the code is there.

## Step 2: Access Portainer

1. Open Portainer in your browser: `http://your-server-ip:9000`
2. Log in with your credentials
3. Go to **Environments** → Select your Docker environment
4. Click **Stacks** (left sidebar)
5. Click **+ Add stack**

## Step 3: Create Stack in Portainer

### Option A: Upload File (Recommended)
1. Name: `quizmaster`
2. Click **"Upload"** 
3. Select `docker-compose.portainer.yml` from your computer
4. Click **"Deploy the stack"**

### Option B: Paste Content
1. Name: `quizmaster`
2. Click **"Web editor"**
3. Paste the content from `docker-compose.portainer.yml`
4. Scroll down to **Environment variables** section
5. Add these variables:
   - `DB_USER` = `quiz_user`
   - `DB_PASSWORD` = `quiz_password` (change this!)
   - `DB_NAME` = `quiz_master`
   - `SERVER_IP` = your server IP address (e.g., `192.168.1.100`)
6. Click **"Deploy the stack"**

## Step 4: Monitor Deployment

1. In Portainer, go to **Containers**
2. You should see 5 containers being created:
   - `quizmaster_postgres_1` (database)
   - `quizmaster_backend_1` (API server)
   - `quizmaster_frontend-admin_1` (Admin dashboard)
   - `quizmaster_frontend-slideshow_1` (Presentation viewer)
   - `quizmaster_frontend-quizzer_1` (Answer portal)

3. **Wait 2-3 minutes** for all to be "Running" (green)

4. Check logs if needed:
   - Click on any container
   - Go to **Logs** tab
   - Look for "Backend server running on..." for backend

## Step 5: Access Your Application

Once all containers are running, access Quiz Master at:

| Component | URL |
|-----------|-----|
| **Admin Dashboard** | http://your-server-ip:3001 |
| **Slideshow Viewer** | http://your-server-ip:3002 |
| **Quizzer Portal** | http://your-server-ip:3003 |
| **Backend API** | http://your-server-ip:5000/api |

## Manage Stack in Portainer

### View Stack Status
1. Go to **Stacks**
2. Click `quizmaster`
3. See all containers and their status

### Update Stack
1. Go to **Stacks** → `quizmaster`
2. Click **"Editor"**
3. Make changes
4. Click **"Update the stack"**

### View Logs
1. Go to **Containers**
2. Click on the container name
3. Go to **Logs** tab
4. See real-time logs

### Access Database
1. Go to **Containers**
2. Click `quizmaster_postgres_1`
3. Click **"Exec console"**
4. Run:
   ```bash
   psql -U quiz_user -d quiz_master
   ```
5. Type SQL commands

### Stop/Start Stack
1. Go to **Stacks** → `quizmaster`
2. Use buttons at top:
   - **Stop** - Stop all containers
   - **Start** - Start all containers
   - **Restart** - Restart all containers

### Delete Stack
1. Go to **Stacks** → `quizmaster`
2. Click **"Remove"** (warning: deletes containers AND data volumes)

## Environment Variables

Set these in Portainer before deploying:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_USER` | quiz_user | PostgreSQL username |
| `DB_PASSWORD` | quiz_password | PostgreSQL password ⚠️ **CHANGE THIS!** |
| `DB_NAME` | quiz_master | Database name |
| `NODE_ENV` | production | Node environment |
| `SERVER_IP` | localhost | Your server IP (for API URLs) |

## Troubleshooting in Portainer

### Containers keep restarting
1. Click on the failing container
2. Go to **Logs** tab
3. Read the error message
4. Common issues:
   - Database not ready yet (wait 30 seconds)
   - Port already in use (change port mapping)
   - Missing environment variables

### Can't connect to API
1. Check `SERVER_IP` environment variable is set correctly
2. Make sure backend container is running
3. Try accessing `http://your-server-ip:5000/api/health`
4. Should return: `{"status":"ok","timestamp":"..."}`

### Database errors
1. Delete the stack (including volumes)
2. Redeploy fresh
3. Or reset database:
   ```bash
   docker-compose down -v
   docker-compose up -d
   ```

### Files not persisting
1. Check volumes in Portainer:
   - Go to **Volumes**
   - Should see `quizmaster_postgres_data` and `quizmaster_backend_uploads`
2. If missing, stack may need restart

## Production Tips

1. **Change database password**: Set `DB_PASSWORD` to something strong
2. **Use specific image versions**: Change `postgres:15-alpine` to exact version like `postgres:15.3-alpine`
3. **Set resource limits**: In Portainer stack editor, add:
   ```yaml
   resources:
     limits:
       cpus: '1'
       memory: 512M
   ```
4. **Enable backups**: Regularly backup the `postgres_data` volume
5. **Monitor logs**: Check container logs weekly for errors
6. **SSL/HTTPS**: Consider adding a reverse proxy (Nginx) in front for HTTPS

## Backup & Restore

### Backup Database
```bash
docker-compose exec postgres pg_dump -U quiz_user quiz_master > backup.sql
```

### Restore Database
```bash
docker-compose exec -T postgres psql -U quiz_user quiz_master < backup.sql
```

### Backup Everything
```bash
tar -czf quiz-master-backup.tar.gz postgres_data/ backend/uploads/
```

## Auto-Update Stack

To automatically pull latest code changes from GitHub:

1. In Portainer, go to **Stacks** → `quizmaster`
2. Click **"Editor"**
3. Change build section to:
   ```yaml
   build:
     context: .
     dockerfile: ./backend/Dockerfile
     args:
       - BUILDKIT_INLINE_CACHE=1
   ```
4. Enable **"Auto update"** on the stack (if available in your Portainer version)

Or manually update:
```bash
cd /opt/quizmaster
git pull origin main
docker-compose -f docker-compose.portainer.yml up -d --build
```

## Getting Help

- Check container logs in Portainer
- Review this guide's Troubleshooting section
- Check backend logs for API errors
- Verify environment variables are set correctly
- Ensure all 5 containers are running and healthy

---

**Enjoy Quiz Master on Portainer!** 🎉
