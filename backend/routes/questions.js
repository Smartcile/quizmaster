const express = require('express');
const router = express.Router();
const {
  getAllQuestions,
  getCategories,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion
} = require('../controllers/questionController');

router.get('/', getAllQuestions);
router.get('/categories', getCategories);
router.get('/:id', getQuestion);
router.post('/', createQuestion);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

module.exports = router;
