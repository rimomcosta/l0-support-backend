// src/routes/analyticsRoutes.js
import express from 'express';
import { UserActivityService } from '../services/userActivityService.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = express.Router();

// Track page view
router.post('/track/page-view', requireAuth, async (req, res) => {
  try {
    const { page_name, page_url, project_id, environment } = req.body;
    
    const userSession = {
      id: req.session.user.id,
      sessionId: req.sessionID,
      groups: req.session.user.groups,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    };

    await UserActivityService.trackPageView(userSession, page_name, page_url, project_id, environment);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to track page view:', error);
    res.status(500).json({ error: 'Failed to track page view' });
  }
});

// Track project selection
router.post('/track/project-selection', requireAuth, async (req, res) => {
  try {
    const { project_id, environment } = req.body;
    
    const userSession = {
      id: req.session.user.id,
      sessionId: req.sessionID,
      groups: req.session.user.groups,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    };

    await UserActivityService.trackProjectSelection(userSession, project_id, environment);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to track project selection:', error);
    res.status(500).json({ error: 'Failed to track project selection' });
  }
});

// Track environment change
router.post('/track/environment-change', requireAuth, async (req, res) => {
  try {
    const { old_environment, new_environment, project_id } = req.body;
    
    const userSession = {
      id: req.session.user.id,
      sessionId: req.sessionID,
      groups: req.session.user.groups,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    };

    await UserActivityService.trackEnvironmentChange(userSession, old_environment, new_environment, project_id);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to track environment change:', error);
    res.status(500).json({ error: 'Failed to track environment change' });
  }
});

// Track project data fetch
router.post('/track/project-data-fetch', requireAuth, async (req, res) => {
  try {
    const { project_id, environment, data_type } = req.body;
    
    const userSession = {
      id: req.session.user.id,
      sessionId: req.sessionID,
      groups: req.session.user.groups,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    };

    await UserActivityService.trackProjectDataFetch(userSession, project_id, environment, data_type);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to track project data fetch:', error);
    res.status(500).json({ error: 'Failed to track project data fetch' });
  }
});

// Track settings change
router.post('/track/settings-change', requireAuth, async (req, res) => {
  try {
    const { setting_type, old_value, new_value } = req.body;
    
    const userSession = {
      id: req.session.user.id,
      sessionId: req.sessionID,
      groups: req.session.user.groups,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    };

    await UserActivityService.trackSettingsChange(userSession, {
      setting_type,
      old_value,
      new_value
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to track settings change:', error);
    res.status(500).json({ error: 'Failed to track settings change' });
  }
});

// Track error
router.post('/track/error', requireAuth, async (req, res) => {
  try {
    const { error_type, error_message, error_context, project_id, environment } = req.body;
    
    const userSession = {
      id: req.session.user.id,
      sessionId: req.sessionID,
      groups: req.session.user.groups,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    };

    await UserActivityService.trackError(userSession, {
      error_type,
      error_message,
      error_context,
      project_id,
      environment
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to track error:', error);
    res.status(500).json({ error: 'Failed to track error' });
  }
});

export default router; 