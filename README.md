# Quiz Master 🎯

A real-time pub quiz application with synchronized slideshow, admin dashboard, and team answer portal. Built with Node.js, React, PostgreSQL, and WebSockets.

## Features

✅ **Admin Dashboard** - Create questions, build rounds, assemble quizzes, and mark answers in real-time
✅ **Slideshow Viewer** - Full-screen presentation controlled by quiz master
✅ **Quizzer Portal** - Team-friendly interface for joining quizzes and submitting answers
✅ **Real-time Sync** - All clients synchronized via WebSockets
✅ **Media Support** - Images, videos, and audio questions
✅ **Drag-and-Drop UI** - Intuitive quiz builder
✅ **Mobile Responsive** - Quizzer portal optimized for phones
✅ **Docker Compose** - One-command deployment

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Nginx (Reverse Proxy)                   │
│                      localhost:80                            │
└─┬─────────────┬──────────────┬──────────────┬──────────────┬┘
  │             │              │              │              │
  ▼             ▼              ▼              ▼              ▼
/admin      /quiz/:code   /answer/:code   /api/*         /socket.io
Admin       Slideshow     Quizzer         Backend        WebSocket
Port 3001   Port 3002     Port 3003      Port 5000       Events
```

### Services

- **postgres** - PostgreSQL 15 (database)
- **backend** - Node.js/Express + Socket.io
- **frontend-admin** - React SPA (Admin Dashboard)
- **frontend-slideshow** - React SPA (Presentation View)
- **frontend-quizzer** - React SPA (Answer Portal)
- **nginx** - Reverse proxy & routing

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Git

### Setup

1. **Clone the repository**
   ```bash
   cd "C:\Users\Smart\OneDrive\Desktop\Quiz Master"
   git init
   git add .
   git commit -m "Initial commit: Quiz Master application"
   ```

2. **Copy environment file**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` if you want to change database credentials or ports.

3. **Start all services**
   ```bash
   docker-compose up -d
   ```
   Docker will build images and start all containers. This takes ~3-5 minutes on first run.

4. **Wait for services to be ready**
   ```bash
   docker-compose logs -f backend
   ```
   Look for: `Backend server running on http://localhost:5000`

5. **Access the application**

   | Component | URL | Purpose |
   |-----------|-----|---------|
   | Admin Dashboard | http://localhost/admin | Create & manage quizzes |
   | Slideshow Viewer | http://localhost/quiz/CODE | Presentation (replace CODE) |
   | Quizzer Portal | http://localhost/answer/CODE | Teams join & answer (replace CODE) |
   | Backend API | http://localhost/api | REST API |

## Usage

### 1. Create Questions (Admin Dashboard)

1. Go to **Questions** tab
2. Fill in question details:
   - Text: The question itself
   - Answer: Correct answer
   - Type: text, mcq (multiple choice), image, video, or audio
   - Points: How many points this question is worth
   - Media URL: URL to image/video/audio (optional)
3. Click "Add Question" or upload a CSV file

**CSV Import Format:**
```
question,answer,type,points,media_url
"What is 2+2?",4,text,1,
"Which planet is biggest?",Jupiter,text,1,
```

### 2. Build Rounds (Rounds Tab)

1. Click **Rounds** tab
2. Select questions from the left panel
3. Enter round name and choose background color
4. Click "Create Round"

Rounds group related questions together (e.g., "Geography Round", "Science Round").

### 3. Assemble Quiz (Quizzes Tab)

1. Click **Quizzes** tab
2. Enter quiz name
3. Select rounds from left panel
4. Optionally add widgets (Scoreboard, Rules, Custom Pages)
5. Click "Create Quiz"
6. Note the generated **Quiz Code** (e.g., `ABC123`)

### 4. Start Quiz & Control (Control Tab)

1. From Dashboard, click "Start Quiz" on any quiz
2. Share the quiz code with participants
3. In Control tab:
   - Use **Previous/Next** to advance slides
   - Click slide numbers to jump to specific slides
   - **Lock Answers** button locks all inputs on Quizzer Portals
4. Share presenter link with projector/TV

### 5. Participants Join (Quizzer Portal)

1. Participants visit http://localhost/answer/CODE
2. Enter team name and size
3. Click "Join Quiz"
4. Questions appear as quiz master advances
5. Teams type/select answers which auto-save
6. When quiz master locks answers, inputs are disabled
7. Once marked, scores appear

### 6. Mark Answers (Answer Marking Tab)

1. After each round, go to **Marking** tab
2. Click on answers to view
3. Use score buttons: **0** (wrong), **0.5** (partial), **1** (correct)
4. Scores broadcast to Quizzer Portals in real-time

## API Reference

### REST Endpoints

**Questions**
- `GET /api/questions` - List all questions
- `POST /api/questions` - Create question
- `PUT /api/questions/:id` - Update question
- `DELETE /api/questions/:id` - Delete question

**Rounds**
- `GET /api/rounds` - List all rounds
- `POST /api/rounds` - Create round
- `PUT /api/rounds/:id` - Update round
- `DELETE /api/rounds/:id` - Delete round

**Quizzes**
- `GET /api/quizzes` - List all quizzes
- `POST /api/quizzes` - Create quiz
- `GET /api/quizzes/:id` - Get quiz details
- `POST /api/quizzes/:id/start` - Start quiz session

**Teams**
- `POST /api/teams/join` - Join quiz
- `GET /api/teams/session/:sessionId` - Get teams in session
- `GET /api/teams/:teamId/scores` - Get team scores

**Answers**
- `POST /api/answers/submit` - Submit answer (auto-saves)
- `GET /api/answers/question` - Get all answers for a question
- `POST /api/answers/mark` - Mark an answer with points

**Files**
- `POST /api/upload/media` - Upload image/video/audio
- `POST /api/upload/csv` - Upload CSV for bulk import

### WebSocket Events

**Broadcast to all viewers**
```javascript
socket.emit('slide_changed', {
  sessionId,
  slideIndex,
  slideData
});

socket.emit('answer_locked', { sessionId, roundId });

socket.emit('mark_answer', {
  sessionId,
  teamId,
  questionId,
  points
});
```

**Received from clients**
```javascript
socket.on('submit_answer', (data) => {
  // { sessionId, teamId, questionId, roundId, answer }
});

socket.on('join_quiz', (data) => {
  // { sessionId, teamId, teamName }
});
```

## Database Schema

### Core Tables

**questions**
- id: Serial primary key
- text: Question text
- answer: Correct answer
- type: text | mcq | image | video | audio
- media_url: Optional media URL
- points: Points awarded
- created_at: Timestamp

**rounds**
- id: Serial primary key
- name: Round name
- background_color: Hex color (#RRGGBB)
- background_image_url: Optional image
- format: standard | rapid-fire | who-am-i
- created_at: Timestamp

**quizzes**
- id: Serial primary key
- code: Unique 6-character code (e.g., ABC123)
- name: Quiz name
- created_at: Timestamp
- updated_at: Timestamp

**quiz_sessions**
- id: Serial primary key
- quiz_id: Foreign key to quiz
- current_slide_index: Current slide number
- status: lobby | active | finished
- created_at: Timestamp

**teams**
- id: Serial primary key
- quiz_session_id: Foreign key
- name: Team name
- size: Number of players
- created_at: Timestamp

**answers**
- id: Serial primary key
- team_id: Foreign key
- question_id: Foreign key
- round_id: Foreign key
- answer_text: Team's answer
- submitted_at: Timestamp

**scores**
- id: Serial primary key
- team_id: Foreign key
- question_id: Foreign key
- points_awarded: 0 | 0.5 | 1
- marked_at: Timestamp

## Development

### Local Development (without Docker)

1. **Start PostgreSQL**
   ```bash
   docker run -e POSTGRES_USER=quiz_user -e POSTGRES_PASSWORD=quiz_password -p 5432:5432 postgres:15-alpine
   ```

2. **Backend**
   ```bash
   cd backend
   npm install
   npm run dev
   ```

3. **Admin Frontend** (new terminal)
   ```bash
   cd frontend-admin
   npm install
   npm run dev
   # Access at http://localhost:3001
   ```

4. **Slideshow** (new terminal)
   ```bash
   cd frontend-slideshow
   npm install
   npm run dev
   # Access at http://localhost:3002
   ```

5. **Quizzer** (new terminal)
   ```bash
   cd frontend-quizzer
   npm install
   npm run dev
   # Access at http://localhost:3003
   ```

### Seed Database

```bash
cd backend
npm install
node utils/database-seed.js
```

## Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend

# Stop all services
docker-compose down

# Rebuild images
docker-compose build --no-cache

# Remove all data (WARNING: deletes database)
docker-compose down -v

# Access PostgreSQL CLI
docker-compose exec postgres psql -U quiz_user -d quiz_master
```

## Troubleshooting

### Port Already in Use

If ports are busy, edit `docker-compose.yml` and change the port mappings:
```yaml
ports:
  - "8080:80"  # Change host port from 80 to 8080
```

### Database Connection Error

1. Check PostgreSQL is running:
   ```bash
   docker-compose logs postgres
   ```

2. Verify credentials in `.env` match `docker-compose.yml`

3. Restart containers:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

### WebSocket Connection Issues

- Check Nginx config is forwarding `/socket.io` correctly
- Ensure `backend` service is healthy: `docker-compose logs backend`
- Try accessing from `http://` not `https://` (SSL requires cert config)

### Frontend Won't Load

1. Ensure backend is running: `docker-compose logs backend`
2. Clear browser cache (Ctrl+Shift+Del)
3. Check frontend container is running: `docker-compose ps`
4. Rebuild frontend: `docker-compose build frontend-admin`

## Performance Tips

- **Large CSV imports**: Upload in batches under 1000 rows
- **Many concurrent teams**: Increase server RAM to 4GB+
- **Video questions**: Use MP4 format, host on CDN for better streaming
- **Live events**: Test with 5-10 teams before running with 50+

## Security

- Change database password in `.env` for production
- Don't expose port 5432 (PostgreSQL) to internet
- Use HTTPS in production (configure Nginx certificates)
- Validate quiz codes to prevent unauthorized access
- Consider adding authentication layer for admin dashboard

## File Structure

```
quiz-master/
├── docker-compose.yml      # Orchestrates all services
├── .env.example            # Environment template
├── README.md               # This file
├── backend/                # Node.js/Express backend
│   ├── server.js           # Entry point
│   ├── schema.sql          # Database schema
│   ├── package.json
│   ├── Dockerfile
│   ├── config/             # Configuration
│   ├── routes/             # API routes
│   ├── controllers/        # Business logic
│   ├── websocket/          # WebSocket handlers
│   ├── utils/              # Utilities
│   └── uploads/            # Media files volume
├── frontend-admin/         # Admin Dashboard
│   ├── src/
│   │   ├── pages/          # Page components
│   │   ├── components/     # Reusable components
│   │   ├── hooks/          # Custom hooks
│   │   ├── styles/
│   │   └── App.jsx
│   ├── Dockerfile
│   └── package.json
├── frontend-slideshow/     # Slideshow Viewer
├── frontend-quizzer/       # Quizzer Portal
├── nginx/                  # Reverse proxy config
└── seed-data/              # Example CSV
```

## License

MIT License - feel free to use for personal or commercial projects.

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review Docker logs: `docker-compose logs`
3. Inspect database: Connect to PostgreSQL with psql
4. Check browser console for client-side errors

## Deployment

To deploy to production:

1. Use a service like DigitalOcean, AWS, Heroku, or your own server
2. Set up a domain name
3. Configure SSL certificates (Let's Encrypt)
4. Update Nginx config with your domain
5. Use stronger database passwords
6. Consider adding authentication/authorization
7. Set up backup strategy for PostgreSQL

## Roadmap

- [ ] User authentication for admin
- [ ] Question bank with categories
- [ ] Leaderboard with live updates
- [ ] Tie-breaker system (sudden death)
- [ ] Export results to CSV/PDF
- [ ] Bonus question multipliers
- [ ] Team vs team competitive scoring
- [ ] Mobile app with offline support

---

Made with 💜 for pub quiz enthusiasts!
