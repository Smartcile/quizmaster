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
const { setupWebSocketHandlers } = require('./websocket/handlers');
const { errorHandler } = require('./middleware/errorHandler');
const { login, requireAdminForWrites } = require('./middleware/auth');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

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

// Teams + answers + upload: kept public so audience clients can write.
// (Adjust if you want stricter control.)
app.use('/api/teams', teamRoutes);
app.use('/api/answers', answerRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

setupWebSocketHandlers(io);

app.use(errorHandler);

db.initializeDatabase().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`WebSocket server ready on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = { app, io };
