const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

require('dotenv').config();

const db = require('./config/database');
const questionRoutes = require('./routes/questions');
const roundRoutes = require('./routes/rounds');
const quizRoutes = require('./routes/quizzes');
const teamRoutes = require('./routes/teams');
const answerRoutes = require('./routes/answers');
const uploadRoutes = require('./routes/upload');
const mastersRoutes = require('./routes/masters');
const slidesRoutes = require('./routes/slides');
const categoriesRoutes = require('./routes/categories');
const mediaRoutes = require('./routes/media');
const repoRoutes = require('./routes/repos');
const { setupWebSocketHandlers } = require('./websocket/handlers');
const { errorHandler } = require('./middleware/errorHandler');
const { login, requireAdminForWrites } = require('./middleware/auth');
const { setIo } = require('./sockets');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
setIo(io); // make io available to controllers without circular requires

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Auth endpoint - public
app.post('/api/auth/login', login);
app.get('/api/auth/verify', (req, res) => {
  // Token validity check - returns 200 if header is valid, 401 otherwise
  const { verifyToken } = require('./middleware/auth');
  verifyToken(req, res, () => res.json({ ok: true }));
});

// Writes require auth for management endpoints. Reads stay public so the
// slideshow + quizzer don't need a token.
app.use('/api/questions', requireAdminForWrites, questionRoutes);
app.use('/api/rounds', requireAdminForWrites, roundRoutes);
app.use('/api/quizzes', requireAdminForWrites, quizRoutes);
app.use('/api/masters', requireAdminForWrites, mastersRoutes);
app.use('/api/slides', requireAdminForWrites, slidesRoutes);
app.use('/api/categories', requireAdminForWrites, categoriesRoutes);

// Teams + answers + upload: kept public so audience clients can write.
// (Adjust if you want stricter control.)
app.use('/api/teams', teamRoutes);
app.use('/api/answers', answerRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/media', requireAdminForWrites, mediaRoutes);
app.use('/api/repos', requireAdminForWrites, repoRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public config endpoint — lets frontends know the canonical URLs for each portal.
// Set QUIZZER_URL / SLIDESHOW_URL / ADMIN_URL in .env to override the default
// port-replacement fallback used in the UI.
app.get('/api/config', (req, res) => {
  res.json({
    quizzerUrl:   process.env.QUIZZER_URL   || null,
    slideshowUrl: process.env.SLIDESHOW_URL || null,
    adminUrl:     process.env.ADMIN_URL     || null,
  });
});

setupWebSocketHandlers(io);

app.use(errorHandler);

// Always start the HTTP server. If the DB is not yet reachable (e.g. running
// outside Docker without postgres), log a warning and let pg-pool retry on the
// first real query. Once postgres comes up the pool connects automatically.
// Inside Docker the postgres health-check ensures it is ready before this starts.
db.initializeDatabase()
  .catch(err => {
    console.error('⚠️  DB not reachable on startup — server starting anyway.');
    console.error('   Set DB_HOST=localhost (or start the postgres container) to fix.');
    console.error('  ', err.message);
  })
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
      console.log(`WebSocket server ready on port ${PORT}`);
    });
  });

module.exports = { app, io };
