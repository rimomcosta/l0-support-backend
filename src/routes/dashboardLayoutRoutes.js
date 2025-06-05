import express from 'express';
import { pool } from '../config/database.js';
import { logger } from '../services/logger.js';
import { conditionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Get dashboard layout for a project/environment
router.get('/dashboard-layouts', conditionalAuth, async (req, res) => {
  try {
    const { projectId, environment } = req.query;
    const userId = req.user?.userId || 'anonymous';

    if (!projectId || !environment) {
      return res.status(400).json({ error: 'projectId and environment are required' });
    }

    const [rows] = await pool.execute(
      'SELECT layouts FROM dashboard_layouts WHERE project_id = ? AND environment = ? AND user_id = ?',
      [projectId, environment, userId]
    );

    if (rows.length === 0) {
      return res.json({ layouts: null });
    }

    return res.json({ layouts: rows[0].layouts });
  } catch (error) {
    logger.error('Error fetching dashboard layout:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard layout' });
  }
});

// Save dashboard layout for a project/environment
router.post('/dashboard-layouts', conditionalAuth, async (req, res) => {
  try {
    const { projectId, environment, layouts } = req.body;
    const userId = req.user?.userId || 'anonymous';

    if (!projectId || !environment || !layouts) {
      return res.status(400).json({ error: 'projectId, environment, and layouts are required' });
    }

    // Use INSERT ... ON DUPLICATE KEY UPDATE to handle both insert and update
    await pool.execute(
      `INSERT INTO dashboard_layouts (project_id, environment, user_id, layouts) 
       VALUES (?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE 
       layouts = VALUES(layouts), 
       updated_at = CURRENT_TIMESTAMP`,
      [projectId, environment, userId, JSON.stringify(layouts)]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Error saving dashboard layout:', error);
    res.status(500).json({ error: 'Failed to save dashboard layout' });
  }
});

// Delete dashboard layout for a project/environment
router.delete('/dashboard-layouts', conditionalAuth, async (req, res) => {
  try {
    const { projectId, environment } = req.query;
    const userId = req.user?.userId || 'anonymous';

    if (!projectId || !environment) {
      return res.status(400).json({ error: 'projectId and environment are required' });
    }

    await pool.execute(
      'DELETE FROM dashboard_layouts WHERE project_id = ? AND environment = ? AND user_id = ?',
      [projectId, environment, userId]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting dashboard layout:', error);
    res.status(500).json({ error: 'Failed to delete dashboard layout' });
  }
});

export default router; 