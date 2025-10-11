// src/routes/tokenUsageRoutes.js
import express from 'express';
import * as tokenUsageController from '../api/core/tokenUsage.js';

const router = express.Router();

// Get current token usage for authenticated user
router.get('/current', tokenUsageController.getCurrentUsage);

// Get token usage history for authenticated user
router.get('/history', tokenUsageController.getUsageHistory);

// Admin: Update user token limit
router.put('/admin/:userId/limit', tokenUsageController.updateUserLimit);

export default router;

