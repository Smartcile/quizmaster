const express = require('express');
const router = express.Router();
const {
  joinQuiz,
  getTeamsBySession,
  getTeamScores,
  getTeamAnswers,
  getTeamById,
  getSessionScoreboard
} = require('../controllers/teamController');

router.post('/join', joinQuiz);
router.get('/session/:sessionId', getTeamsBySession);
router.get('/session/:sessionId/scoreboard', getSessionScoreboard);
router.get('/:teamId/scores', getTeamScores);
router.get('/:teamId/answers', getTeamAnswers);
router.get('/:teamId', getTeamById);

module.exports = router;
