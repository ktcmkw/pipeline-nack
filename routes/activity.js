const express = require('express');
const { query } = require('../db/db');
const { requireAdmin } = require('../middleware/requireAuth');
const router = express.Router();

// DELETE /api/activity — ลบ activity log ทั้งหมด (admin only)
router.delete('/', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM activity_log');
    res.json({ ok: true, message: 'Activity log cleared' });
  } catch (err) {
    console.error('[activity] clear error:', err.message);
    res.status(500).json({ error: 'Failed to clear activity log' });
  }
});

// DELETE /api/activity/:id — ลบรายการเดียว (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const result = await query('DELETE FROM activity_log WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[activity] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

module.exports = router;
