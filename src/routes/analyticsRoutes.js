import express from 'express';
import * as analyticsController from '../api/app/analytics.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Track page view
router.post('/track/page-view', requireAuth, analyticsController.trackPageView);

// Track project selection
router.post('/track/project-selection', requireAuth, analyticsController.trackProjectSelection);

// Track environment change
router.post('/track/environment-change', requireAuth, analyticsController.trackEnvironmentChange);

// Track project data fetch
router.post('/track/project-data-fetch', requireAuth, analyticsController.trackProjectDataFetch);

// Track settings change
router.post('/track/settings-change', requireAuth, analyticsController.trackSettingsChange);

// Track error
router.post('/track/error', requireAuth, analyticsController.trackError);

export default router;