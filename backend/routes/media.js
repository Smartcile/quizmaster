const express = require('express');
const router = express.Router();
const { listMedia, getMediaUsage, deleteMedia, listFolders, updateMedia, fetchLyrics } = require('../controllers/mediaController');

router.get('/',           listMedia);
router.get('/folders',    listFolders);   // literal route before /:id/usage
router.get('/:id/usage',  getMediaUsage);
router.post('/:id/fetch-lyrics', fetchLyrics);
router.put('/:id',        updateMedia);
router.delete('/:id',     deleteMedia);

module.exports = router;
