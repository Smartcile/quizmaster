const express = require('express');
const router = express.Router();
const {
  getAllQuizzes,
  getQuiz,
  getQuizByCode,
  getActiveSession,
  resolveCode,
  createQuiz,
  startQuiz,
  setSessionStatus,
  setSessionSlide,
  restartSession,
  getSession,
  reorderQuiz,
  deleteQuiz,
  updateQuiz,
  getSessionHistory,
  getSessionResults,
  getActiveTestSessions,
  deleteAllTestSessions,
  deleteSession,
  setScoreboardVisibility
} = require('../controllers/quizController');

router.get('/', getAllQuizzes);
router.get('/resolve/:code', resolveCode);
router.get('/by-code/:code', getQuizByCode);
router.get('/:id', getQuiz);
router.get('/:id/active-session', getActiveSession);
router.post('/', createQuiz);
router.post('/:id/start', startQuiz);
router.put('/:id/reorder', reorderQuiz);
router.put('/:id', updateQuiz);
router.delete('/:id', deleteQuiz);

// Session lifecycle — literal routes MUST precede /:sessionId to avoid param collision
router.get('/sessions/history',              getSessionHistory);
router.get('/sessions/test',                 getActiveTestSessions);
router.delete('/sessions/test',              deleteAllTestSessions);
router.get('/sessions/:sessionId/results',   getSessionResults);
router.get('/sessions/:sessionId', getSession);
router.put('/sessions/:sessionId/status', setSessionStatus);
router.put('/sessions/:sessionId/slide', setSessionSlide);
router.post('/sessions/:sessionId/restart', restartSession);
router.put('/sessions/:sessionId/scoreboard-visibility', setScoreboardVisibility);
router.delete('/sessions/:sessionId', deleteSession);

module.exports = router;
