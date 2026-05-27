const express = require('express');
const router = express.Router();
const {
  joinQuiz,
  getTeamsBySession,
  getTeamScores,
  getTeamById
} = require('../controllers/teamController');

router.post('/join', joinQuiz);
router.get('/session/:sessionId', getTeamsBySession);
router.get('/:teamId/scores', getTeamScores);
router.get('/:teamId', getTeamById);

module.exports = router;
