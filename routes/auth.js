const express  = require('express');
const bcrypt   = require('bcryptjs');
const { query } = require('../db/db');
const router   = express.Router();

// ─── POST /auth/register ──────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, password, display_name, email } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });
  if (username.length < 3 || username.length > 50)
    return res.status(400).json({ error: 'Username must be 3–50 characters' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const exists = await query('SELECT id FROM users WHERE username = $1', [username.trim()]);
    if (exists.rows.length)
      return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 12);

    // First user ever → auto admin
    const countRes = await query('SELECT COUNT(*) AS cnt FROM users');
    const isFirst  = parseInt(countRes.rows[0].cnt, 10) === 0;

    // Also check ADMIN_USERNAMES env list
    const adminList = (process.env.ADMIN_GITHUB_USERNAMES || process.env.ADMIN_USERNAMES || '')
      .split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
    const role = (isFirst || adminList.includes(username.trim().toLowerCase()))
      ? 'admin' : 'viewer';

    const result = await query(
      `INSERT INTO users (username, display_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, display_name, role`,
      [username.trim(), display_name?.trim() || username.trim(), email?.trim() || null, hash, role]
    );

    req.session.userId = result.rows[0].id;
    req.session.save((err) => {
      if (err) {
        console.error('[auth/register] session save error:', err.message);
        return res.status(500).json({ error: 'Session error' });
      }
      res.status(201).json({ ok: true, user: result.rows[0] });
    });
  } catch (err) {
    console.error('[auth/register]', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /auth/login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required' });

  try {
    const result = await query(
      'SELECT * FROM users WHERE username = $1', [username.trim()]
    );
    const user = result.rows[0];
    if (!user)
      return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid username or password' });

    req.session.userId = user.id;
    // Explicitly save session before sending response (important on Render)
    req.session.save((err) => {
      if (err) {
        console.error('[auth/login] session save error:', err.message);
        return res.status(500).json({ error: 'Session error' });
      }
      res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          role: user.role,
        }
      });
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /auth/logout ────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ─── GET /auth/me — current user info ────────────────────────
router.get('/me', async (req, res) => {
  if (!req.session.userId)
    return res.json({ authenticated: false });
  try {
    const result = await query(
      'SELECT id, username, display_name, role FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (!result.rows.length) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
