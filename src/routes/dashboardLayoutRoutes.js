import express from 'express';
import * as dashboardLayoutController from '../api/app/dashboardLayout.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET dashboard layout for the authenticated user
router.get('/dashboard-layouts', requireAuth, dashboardLayoutController.getDashboardLayout);

// POST (Save) dashboard layout for the authenticated user
router.post('/dashboard-layouts', requireAuth, dashboardLayoutController.saveDashboardLayout);

// DELETE dashboard layout for the authenticated user
router.delete('/dashboard-layouts', requireAuth, dashboardLayoutController.deleteDashboardLayout);

export default router;