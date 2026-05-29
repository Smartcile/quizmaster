const express = require('express');
const router = express.Router();
const { listMedia, getMediaUsage, deleteMedia } = require('../controllers/mediaController');

router.get('/',           listMedia);
router.get('/:id/usage',  getMediaUsage);
router.delete('/:id',     deleteMedia);

module.exports = router;
