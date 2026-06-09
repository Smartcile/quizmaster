const express = require('express');
const router = express.Router();
const { getAllMasters, getMaster, createMaster, updateMaster, duplicateMaster, deleteMaster, setDefaultMaster } = require('../controllers/mastersController');

router.get('/', getAllMasters);
router.get('/:id', getMaster);
router.post('/', createMaster);
router.put('/:id/default', setDefaultMaster);
router.put('/:id', updateMaster);
router.post('/:id/duplicate', duplicateMaster);
router.delete('/:id', deleteMaster);

module.exports = router;
