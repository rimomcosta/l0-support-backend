import express from 'express';
import * as adminAnalyticsController from '../api/core/adminAnalytics.js';
import * as adminAnalyticsTestController from '../api/core/adminAnalyticsTest.js';
import { requireAdmin } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = express.Router();

logger.info('=== ADMIN ANALYTICS ROUTES LOADED ===');

// Test route
router.get('/test', adminAnalyticsTestController.testRoute);

// Test route with parameter
router.get('/test/:param', adminAnalyticsTestController.testRouteWithParam);

/**
 * Get individual user details
 */
router.get('/getuser/:userId', adminAnalyticsController.getUserDetails);

/**
 * Get comprehensive user analytics
 */
router.get('/users/:userId/analytics', requireAdmin, adminAnalyticsController.getUserAnalytics);

/**
 * Update user information
 */
router.put('/users/:userId', requireAdmin, adminAnalyticsController.updateUser);

/**
 * Revoke user API token
 */
router.post('/users/:userId/revoke-token', requireAdmin, adminAnalyticsController.revokeUserToken);

/**
 * Delete user (soft delete - mark as inactive)
 */
router.delete('/users/:userId', requireAdmin, adminAnalyticsController.deleteUser);

/**
 * Get all users with analytics summary
 */
router.get('/users', requireAdmin, adminAnalyticsController.getAllUsers);

/**
 * Test elasticsearch connection
 */
router.get('/test', requireAdmin, adminAnalyticsController.testElasticsearch);

/**
 * Test elasticsearch search
 */
router.get('/test-search', requireAdmin, adminAnalyticsController.testElasticsearchSearch);

/**
 * Get system overview analytics
 */
router.get('/overview', requireAdmin, adminAnalyticsController.getSystemOverview);

/**
 * Get error tracking data
 */
router.get('/errors', requireAdmin, adminAnalyticsController.getErrorTracking);

/**
 * Mark error as resolved
 */
router.put('/errors/:errorId/resolve', requireAdmin, adminAnalyticsController.resolveError);

/**
 * Get most accessed pages
 */
router.get('/pages/most-accessed', requireAdmin, adminAnalyticsController.getMostAccessedPages);

/**
 * Get most active users
 */
router.get('/users/most-active', requireAdmin, adminAnalyticsController.getMostActiveUsers);

/**
 * Get most executed commands
 */
router.get('/commands/most-executed', requireAdmin, adminAnalyticsController.getMostExecutedCommands);

/**
 * Get user activity timeline
 */
router.get('/users/:userId/timeline', requireAdmin, adminAnalyticsController.getUserTimeline);

/**
 * Get project usage analytics
 */
router.get('/projects/usage', requireAdmin, adminAnalyticsController.getProjectUsage);

/**
 * Get real-time system metrics
 */
router.get('/metrics/realtime', requireAdmin, adminAnalyticsController.getRealtimeMetrics);

/**
 * Get user activities with filters
 */
router.get('/users/:userId/activities', requireAdmin, adminAnalyticsController.getUserActivities);

/**
 * Get user errors
 */
router.get('/users/:userId/errors', requireAdmin, adminAnalyticsController.getUserErrors);

/**
 * Get user sessions
 */
router.get('/users/:userId/sessions', requireAdmin, adminAnalyticsController.getUserSessions);

/**
 * Delete user activities
 */
router.delete('/users/:userId/activities', requireAdmin, adminAnalyticsController.deleteUserActivities);

/**
 * Resolve error
 */
router.put('/errors/:errorId/resolve', requireAdmin, adminAnalyticsController.resolveErrorById);

/**
 * Export user data
 */
router.get('/users/:userId/export', requireAdmin, adminAnalyticsController.exportUserData);

export default router;