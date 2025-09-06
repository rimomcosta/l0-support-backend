import express from 'express';
import * as ipReportController from '../api/app/ipReport.js';
import { conditionalAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/v1/ip-report/generate
 * Generate IP access report using SQLite database
 */
router.post('/generate', conditionalAuth, ipReportController.generateReport);

/**
 * GET /api/v1/ip-report/chart-data
 * Get chart data for specific IPs and time range
 */
router.get('/chart-data', conditionalAuth, ipReportController.getChartData);

/**
 * GET /api/v1/ip-report/ip-details/:ip
 * Get paginated IP details with optional filters
 */
router.get('/ip-details/:ip', conditionalAuth, ipReportController.getIpDetails);

/**
 * GET /api/v1/ip-report/urls/:ip
 * Get paginated URLs for a specific IP
 */
router.get('/urls/:ip', conditionalAuth, ipReportController.getIpUrls);

/**
 * GET /api/v1/ip-report/user-agents/:ip
 * Get UserAgent data for a specific IP
 */
router.get('/user-agents/:ip', conditionalAuth, ipReportController.getIpUserAgents);

/**
 * DELETE /api/v1/ip-report/cleanup
 * Cleanup database and clear cached data for a project environment
 */
router.delete('/cleanup', conditionalAuth, ipReportController.cleanupData);

export default router;