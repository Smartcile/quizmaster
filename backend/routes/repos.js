const express = require('express');
const router = express.Router();
const { listRepos, addRepo, updateRepo, deleteRepo, syncRepo } = require('../controllers/repoController');

router.get('/', listRepos);
router.post('/', addRepo);
router.put('/:id', updateRepo);
router.post('/:id/sync', syncRepo);
router.delete('/:id', deleteRepo);

module.exports = router;
