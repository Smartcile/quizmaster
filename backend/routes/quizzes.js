const express = require('express');
const router = express.Router();
const {
  getAllQuizzes,
  getQuiz,
  getQuizByCode,
  getActiveSession,
  createQuiz,
  startQuiz,
  endQuiz
} = require('../controllers/quizController');

router.get('/', getAllQuizzes);
router.get('/by-code/:code', getQuizByCode);
router.get('/:id', getQuiz);
router.get('/:id/active-session', getActiveSession);
router.post('/', createQuiz);
router.post('/:id/start', startQuiz);
router.post('/:sessionId/end', endQuiz);

module.exports = router;
