const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { verifyToken } = require('../middleware/auth');
const {
  joinQuiz,
  getTeamsBySession,
  getTeamScores,
  getTeamAnswers,
  getTeamById,
  getSessionScoreboard,
  getTeamByDevice,
  createTeamAdmin,
  updateTeam,
  deleteTeam
} = require('../controllers/teamController');
const {
  listSessionPhotos,
  uploadPhoto,
  deletePhoto,
  transcribePhoto
} = require('../controllers/teamPhotoController');

// Answer-sheet photos are camera images only, kept in the same uploads volume as
// media so the existing /uploads static + nginx proxy serve them.
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
    filename: (req, file, cb) => {
      const safe = String(file.originalname || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `answer-${Date.now()}-${safe}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype || ''))
});

// Answer-sheet photo routes (writes + AI spend are token-gated).
router.get('/session/:sessionId/photos', listSessionPhotos);
router.post('/:teamId/photos', verifyToken, photoUpload.single('file'), uploadPhoto);
router.delete('/photos/:photoId', verifyToken, deletePhoto);
router.post('/photos/:photoId/transcribe', verifyToken, transcribePhoto);

router.post('/join', joinQuiz);
router.post('/', createTeamAdmin);
router.get('/session/:sessionId', getTeamsBySession);
router.get('/session/:sessionId/scoreboard', getSessionScoreboard);
router.get('/session/:sessionId/device/:deviceId', getTeamByDevice);
router.get('/:teamId/scores', getTeamScores);
router.get('/:teamId/answers', getTeamAnswers);
router.get('/:teamId', getTeamById);
router.put('/:teamId', updateTeam);
router.delete('/:teamId', deleteTeam);

module.exports = router;
