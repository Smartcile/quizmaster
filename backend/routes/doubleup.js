const express = require('express');
const router = express.Router();
const { getSessionChoices, chooseRound } = require('../controllers/doubleupController');

// Public (like /api/whoami) so the quizzer can set its choice without a token.
router.get('/session/:sessionId', getSessionChoices);
router.post('/choose', chooseRound);

module.exports = router;
