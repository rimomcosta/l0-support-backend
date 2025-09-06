import express from 'express';
import * as aiSettingsController from '../api/core/aiSettings.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET user AI settings
router.get('/ai-settings', requireAuth, aiSettingsController.getAiSettings);

// POST save user AI settings
router.post('/ai-settings', requireAuth, aiSettingsController.saveAiSettings);

// POST reset user AI settings to defaults
router.post('/ai-settings/reset', requireAuth, aiSettingsController.resetAiSettings);

export default router;