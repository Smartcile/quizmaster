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
  setSessionSlide,
  restartSession,
  getSession,
  reorderQuiz,
  deleteQuiz,
  updateQuiz,
  getSessionHistory,
  getSessionResults
} = require('../controllers/quizController');

router.get('/', getAllQuizzes);
router.get('/by-code/:code', getQuizByCode);
router.get('/:id', getQuiz);
router.get('/:id/active-session', getActiveSession);
router.post('/', createQuiz);
router.post('/:id/start', startQuiz);
router.put('/:id/reorder', reorderQuiz);
router.put('/:id', updateQuiz);
router.delete('/:id', deleteQuiz);

// Session lifecycle — history routes MUST precede /:sessionId to avoid param collision
router.get('/sessions/history',              getSessionHistory);
router.get('/sessions/:sessionId/results',   getSessionResults);
router.get('/sessions/:sessionId', getSession);
router.put('/sessions/:sessionId/status', setSessionStatus);
router.put('/sessions/:sessionId/slide', setSessionSlide);
router.post('/sessions/:sessionId/restart', restartSession);

module.exports = router;
