const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const TOKEN_TTL = '12h';

function login(req, res) {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, expiresIn: TOKEN_TTL });
}

function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization header' });

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional: only enforce on writes. Public reads needed by slideshow/quizzer.
function requireAdminForWrites(req, res, next) {
  const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
  if (!isWrite) return next();
  return verifyToken(req, res, next);
}

module.exports = { login, verifyToken, requireAdminForWrites };
