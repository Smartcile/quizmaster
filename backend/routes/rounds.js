const express = require('express');
const router = express.Router();
const {
  getAllRounds,
  getRound,
  createRound,
  updateRound,
  deleteRound
} = require('../controllers/roundController');

router.get('/', getAllRounds);
router.get('/:id', getRound);
router.post('/', createRound);
router.put('/:id', updateRound);
router.delete('/:id', deleteRound);

module.exports = router;
