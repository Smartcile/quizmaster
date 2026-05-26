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

app.use('/api/questions', questionRoutes);
app.use('/api/rounds', roundRoutes);
app.use('/api/quizzes', quizRoutes);
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
