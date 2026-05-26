const express = require('express');
const router = express.Router();
const {
  getAllQuizzes,
  getQuiz,
  createQuiz,
  startQuiz,
  endQuiz
} = require('../controllers/quizController');

router.get('/', getAllQuizzes);
router.get('/:id', getQuiz);
router.post('/', createQuiz);
router.post('/:id/start', startQuiz);
router.post('/:sessionId/end', endQuiz);

module.exports = router;
