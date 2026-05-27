const express = require('express');
const router = express.Router();
const {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory
} = require('../controllers/categoriesController');

router.get('/',       getAllCategories);
router.post('/',      createCategory);
router.put('/:id',    updateCategory);
router.delete('/:id', deleteCategory);

module.exports = router;
