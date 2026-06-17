const express = require('express');
const router = express.Router();
const { resetData } = require('../controllers/adminController');

router.post('/reset', resetData);

module.exports = router;
