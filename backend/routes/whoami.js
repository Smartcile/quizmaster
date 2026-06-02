const express = require('express');
const router = express.Router();
const {
  getSessionWhoami,
  lockGuess,
  markGuess
} = require('../controllers/whoamiController');

// Public (like /api/answers) so the quizzer can lock in without a token.
router.get('/session/:sessionId', getSessionWhoami);
router.post('/lock', lockGuess);
router.post('/mark', markGuess);

module.exports = router;
