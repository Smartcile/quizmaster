const express = require('express');
const router = express.Router();
const { getAllMasters, getMaster, createMaster, updateMaster, duplicateMaster } = require('../controllers/mastersController');

router.get('/', getAllMasters);
router.get('/:id', getMaster);
router.post('/', createMaster);
router.put('/:id', updateMaster);
router.post('/:id/duplicate', duplicateMaster);

module.exports = router;
