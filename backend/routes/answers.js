const express = require('express');
const router = express.Router();
const {
  submitAnswer,
  getAnswersByQuestion,
  getTeamAnswers,
  markAnswer,
  getSessionAnswers,
  exportAnswersCSV,
  awardBrowniePoints
} = require('../controllers/answerController');

router.post('/submit',                 submitAnswer);
router.get('/question',                getAnswersByQuestion);
router.get('/team',                    getTeamAnswers);
router.post('/mark',                   markAnswer);
router.get('/session/:sessionId',      getSessionAnswers);
router.get('/export',                  exportAnswersCSV);
router.post('/brownie-points',         awardBrowniePoints);

module.exports = router;
