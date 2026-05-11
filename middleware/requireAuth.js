const { query } = require('../db/db');

// Attach req.user from session on every request
async function loadUser(req, res, next) {
  if (!req.session.userId) return next();
  try {
    const result = await query(
      'SELECT id, username, display_name, role FROM users WHERE id = $1',
      [req.session.userId]
    );
    req.user = result.rows[0] || null;
  } catch (_) {
    req.user = null;
  }
  next();
}

// Require authenticated session
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.headers['accept']?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login.html');
}

// Require admin role
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden — admin only' });
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin };
