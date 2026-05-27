const express = require('express');
const router = express.Router();
const { listSlides, getSlide, createSlide, updateSlideContent, deleteSlide } = require('../controllers/slidesController');

router.get('/', listSlides);
router.get('/:id', getSlide);
router.post('/', createSlide);
router.put('/:id/content', updateSlideContent);
router.delete('/:id', deleteSlide);

module.exports = router;
