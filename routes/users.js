const express = require('express');
const { query } = require('../db/db');
const { requireAdmin } = require('../middleware/requireAuth');
const router = express.Router();

// GET /api/users — list all users (admin only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, display_name, avatar_url, email, role, created_at
         FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/users/:id/role — change role (admin only)
router.put('/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'viewer'].includes(role))
    return res.status(400).json({ error: 'Role must be admin or viewer' });

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (id === req.user.id)
    return res.status(400).json({ error: 'Cannot change your own role' });

  try {
    const result = await query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role`,
      [role, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

module.exports = router;
