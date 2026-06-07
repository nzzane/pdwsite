const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const config = require('./config');
const db = require('./db');

/**
 * Express middleware: requires a valid JWT in Authorization header OR ?token= query param.
 * Query param is needed for browser media elements (<audio>) which can't set headers.
 * Populates req.user with { id, username, role }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const raw = (header && header.startsWith('Bearer '))
    ? header.slice(7)
    : req.query.token;
  if (!raw) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(raw, config.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Express middleware: requires req.user.role === 'admin'.
 * Must be used after requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Express middleware: requires valid API_KEY in X-API-Key header.
 * Checks DB settings first, falls back to config (env var).
 */
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Invalid API key' });

  // Check DB setting first, fall back to env var
  const row = db.prepare("SELECT value FROM settings WHERE key = 'api_key'").get();
  const validKey = (row && row.value) || config.API_KEY;

  if (key !== validKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

/**
 * Login: returns JWT token.
 */
async function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRY }
  );
  return {
    token,
    user: { id: user.id, username: user.username, role: user.role, must_change_password: !!user.must_change_password },
  };
}

/**
 * Register a new user account.
 */
async function register(username, password, role = 'user', mustChangePassword = false) {
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)').run(
    username, hash, role, mustChangePassword ? 1 : 0
  );
  return { user: { id: result.lastInsertRowid, username, role } };
}

/**
 * Issue a fresh JWT for a known user object (used by refresh endpoint).
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRY }
  );
}

module.exports = { requireAuth, requireAdmin, requireApiKey, login, register, generateToken };
