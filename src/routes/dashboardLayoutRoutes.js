// src/routes/dashboardLayoutRoutes.js
import express from 'express';
import { pool } from '../config/database.js';
import { logger } from '../services/logger.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET dashboard layout for the authenticated user
router.get('/dashboard-layouts', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [rows] = await pool.execute(
      'SELECT layouts FROM dashboard_layouts WHERE user_id = ?',
      [userId]
    );

    // If no layout is found in the DB, return a default empty structure.
    if (rows.length === 0 || !rows[0].layouts) {
      return res.json({
        layouts: null,
        pinnedItems: [],
        collapsedItems: {},
        userModifiedMap: {}
      });
    }

    // The 'layouts' column is a JSON type, mysql2 driver automatically parses it.
    // The `layoutData` variable now holds the complete object: { layouts: {...}, pinnedItems: [...], ... }
    const layoutData = rows[0].layouts;

    // Directly return the properties of the stored object.
    return res.json({
      layouts: layoutData.layouts || null,
      pinnedItems: layoutData.pinnedItems || [],
      collapsedItems: layoutData.collapsedItems || {},
      userModifiedMap: layoutData.userModifiedMap || {}
    });

  } catch (error) {
    logger.error(`[GET LAYOUT - USER: ${req.session.user.id}] Error fetching layout:`, { errorMessage: error.message });
    res.status(500).json({ error: 'Failed to fetch dashboard layout' });
  }
});

// POST (Save) dashboard layout for the authenticated user
router.post('/dashboard-layouts', requireAuth, async (req, res) => {
  try {
    const { layouts, pinnedItems = [], collapsedItems = {}, userModifiedMap = {} } = req.body;
    const userId = req.session.user.id;

    if (!layouts) {
      return res.status(400).json({ error: 'Layouts data is required' });
    }

    // Consolidate the entire state into one object to be stored in the JSON column.
    const layoutDataToStore = { layouts, pinnedItems, collapsedItems, userModifiedMap };
    const stringifiedLayoutData = JSON.stringify(layoutDataToStore);

    await pool.execute(
      `INSERT INTO dashboard_layouts (user_id, layouts) 
       VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE 
       layouts = VALUES(layouts), 
       updated_at = CURRENT_TIMESTAMP`,
      [userId, stringifiedLayoutData]
    );

    res.json({ success: true, message: 'Dashboard layout saved successfully.' });
  } catch (error) {
    logger.error(`[SAVE LAYOUT - USER: ${req.session?.user?.id}] Error saving dashboard layout:`, { errorMessage: error.message });
    res.status(500).json({ error: 'Failed to save dashboard layout' });
  }
});

// DELETE dashboard layout for the authenticated user
router.delete('/dashboard-layouts', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    await pool.execute(
      'DELETE FROM dashboard_layouts WHERE user_id = ?',
      [userId]
    );
    res.json({ success: true, message: 'Dashboard layout reset successfully.' });
  } catch (error) {
    logger.error(`[DELETE LAYOUT - USER: ${req.session.user.id}] Error deleting dashboard layout:`, { errorMessage: error.message });
    res.status(500).json({ error: 'Failed to delete dashboard layout' });
  }
});

export default router;