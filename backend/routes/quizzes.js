const express = require('express');
const router = express.Router();
const {
  getAllQuizzes,
  getQuiz,
  getQuizByCode,
  getActiveSession,
  createQuiz,
  startQuiz,
  setSessionStatus,
  restartSession,
  getSession
} = require('../controllers/quizController');

router.get('/', getAllQuizzes);
router.get('/by-code/:code', getQuizByCode);
router.get('/:id', getQuiz);
router.get('/:id/active-session', getActiveSession);
router.post('/', createQuiz);
router.post('/:id/start', startQuiz);

// Session lifecycle
router.get('/sessions/:sessionId', getSession);
router.put('/sessions/:sessionId/status', setSessionStatus);
router.post('/sessions/:sessionId/restart', restartSession);

module.exports = router;
