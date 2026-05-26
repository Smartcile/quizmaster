const express = require('express');
const router = express.Router();
const {
  joinQuiz,
  getTeamsBySession,
  getTeamScores
} = require('../controllers/teamController');

router.post('/join', joinQuiz);
router.get('/session/:sessionId', getTeamsBySession);
router.get('/:teamId/scores', getTeamScores);

module.exports = router;
