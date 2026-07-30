const express = require('express');
const router = express.Router();
const { getSessionChoices, chooseRound, adminSetRound } = require('../controllers/doubleupController');
const { verifyToken } = require('../middleware/auth');

// Public (like /api/whoami) so the quizzer can set its choice without a token.
router.get('/session/:sessionId', getSessionChoices);
router.post('/choose', chooseRound);

// Host override from the Control page. Token-gated because it deliberately skips
// the locked-round rules that bind a team's own pick.
router.post('/admin-set', verifyToken, adminSetRound);

module.exports = router;
