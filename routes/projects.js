const express = require('express');
const { query } = require('../db/db');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const router = express.Router();

const VALID_STATUSES   = ['dev', 'qa', 'deploy', 'done', 'delay'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];

// ─── GET /api/projects — list all (public read after login) ───
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*,
             u.username    AS created_by_username,
             u.display_name AS created_by_display
        FROM projects p
        LEFT JOIN users u ON p.created_by = u.id
       ORDER BY
         CASE p.status   WHEN 'delay'  THEN 0 ELSE 1 END,
         CASE p.priority WHEN 'high'   THEN 0
                         WHEN 'medium' THEN 1
                         ELSE               2 END,
         p.updated_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ─── GET /api/projects/stats — KPI summary ───────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)                                     AS total,
        COUNT(*) FILTER (WHERE status = 'done')      AS completed,
        COUNT(*) FILTER (WHERE status = 'delay')     AS delayed,
        COUNT(*) FILTER (WHERE status NOT IN ('done','delay')) AS active,
        ROUND(AVG(progress))                         AS avg_progress,
        COUNT(*) FILTER (WHERE status = 'dev')       AS in_dev,
        COUNT(*) FILTER (WHERE status = 'qa')        AS in_qa,
        COUNT(*) FILTER (WHERE status = 'deploy')    AS in_deploy
      FROM projects
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/projects/activity — recent feed ────────────────
router.get('/activity', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT a.*, p.name AS project_name
        FROM activity_log a
        LEFT JOIN projects p ON a.project_id = p.id
       ORDER BY a.created_at DESC
       LIMIT 30
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// ─── GET /api/projects/:id ────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// ─── POST /api/projects — create (admin only) ────────────────
router.post('/', requireAdmin, async (req, res) => {
  const { name, description, status, progress, priority, owner_name, due_date, tags } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  if (priority && !VALID_PRIORITIES.includes(priority))
    return res.status(400).json({ error: 'Invalid priority' });
  if (progress !== undefined && (progress < 0 || progress > 100))
    return res.status(400).json({ error: 'Progress must be 0–100' });

  try {
    const result = await query(`
      INSERT INTO projects (name, description, status, progress, priority, owner_name, due_date, tags, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      name.trim(),
      description || null,
      status || 'dev',
      progress ?? 0,
      priority || 'medium',
      owner_name || null,
      due_date || null,
      tags || [],
      req.user.id,
    ]);

    const project = result.rows[0];

    // Log activity
    await query(
      `INSERT INTO activity_log (project_id, user_id, username, action, new_value)
       VALUES ($1, $2, $3, 'created', $4)`,
      [project.id, req.user.id, req.user.username, project.name]
    );

    // Emit realtime event
    req.app.get('io').emit('project:created', project);
    req.app.get('io').emit('activity:new', {
      project_name: project.name,
      username: req.user.username,
      action: 'created',
      new_value: project.name,
      created_at: new Date().toISOString(),
    });

    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ─── PUT /api/projects/:id — update (admin only) ─────────────
router.put('/:id', requireAdmin, async (req, res) => {
  const { name, description, status, progress, priority, owner_name, due_date, tags } = req.body;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  if (priority && !VALID_PRIORITIES.includes(priority))
    return res.status(400).json({ error: 'Invalid priority' });
  if (progress !== undefined && (progress < 0 || progress > 100))
    return res.status(400).json({ error: 'Progress must be 0–100' });

  try {
    // Fetch current for diff
    const current = await query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Not found' });
    const old = current.rows[0];

    const result = await query(`
      UPDATE projects SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        status      = COALESCE($3, status),
        progress    = COALESCE($4, progress),
        priority    = COALESCE($5, priority),
        owner_name  = COALESCE($6, owner_name),
        due_date    = COALESCE($7, due_date),
        tags        = COALESCE($8, tags)
      WHERE id = $9
      RETURNING *
    `, [
      name?.trim() || null,
      description !== undefined ? description : null,
      status || null,
      progress !== undefined ? progress : null,
      priority || null,
      owner_name !== undefined ? owner_name : null,
      due_date !== undefined ? due_date : null,
      tags || null,
      id,
    ]);

    const updated = result.rows[0];

    // Log status change
    if (status && status !== old.status) {
      await query(
        `INSERT INTO activity_log (project_id, user_id, username, action, old_value, new_value)
         VALUES ($1, $2, $3, 'status_changed', $4, $5)`,
        [id, req.user.id, req.user.username, old.status, status]
      );
      req.app.get('io').emit('activity:new', {
        project_name: updated.name,
        username: req.user.username,
        action: 'status_changed',
        old_value: old.status,
        new_value: status,
        created_at: new Date().toISOString(),
      });
    } else {
      await query(
        `INSERT INTO activity_log (project_id, user_id, username, action, new_value)
         VALUES ($1, $2, $3, 'updated', $4)`,
        [id, req.user.id, req.user.username, updated.name]
      );
    }

    req.app.get('io').emit('project:updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ─── DELETE /api/projects/:id — admin only ───────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const current = await query('SELECT name FROM projects WHERE id = $1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Not found' });

    await query('DELETE FROM projects WHERE id = $1', [id]);

    await query(
      `INSERT INTO activity_log (user_id, username, action, old_value)
       VALUES ($1, $2, 'deleted', $3)`,
      [req.user.id, req.user.username, current.rows[0].name]
    );

    req.app.get('io').emit('project:deleted', { id });
    req.app.get('io').emit('activity:new', {
      project_name: current.rows[0].name,
      username: req.user.username,
      action: 'deleted',
      created_at: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
