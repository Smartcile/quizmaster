const express = require('express');
const router = express.Router();
const {
  getAllQuestions,
  getCategories,
  getStats,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  exportQuestionsCSV
} = require('../controllers/questionController');

router.get('/', getAllQuestions);
router.get('/categories', getCategories);
router.get('/stats', getStats);
router.get('/export', exportQuestionsCSV);
router.get('/:id', getQuestion);
router.post('/', createQuestion);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

module.exports = router;
