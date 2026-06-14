const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');

router.get('/', getSettings);   // public read so any surface can check a flag
router.put('/', updateSettings); // write requires a token (requireAdminForWrites)

module.exports = router;
