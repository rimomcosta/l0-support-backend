import express from 'express';
import { ipReportService } from '../services/ipReportService.js';
import { sqliteService } from '../services/sqliteService.js';
import { logger } from '../services/logger.js';
import { logActivity } from '../services/activityLogger.js';
import { conditionalAuth } from '../middleware/auth.js';
import { WebSocketService } from '../services/webSocketService.js';
import fs from 'fs';

const router = express.Router();

// Simple validation function for IP report inputs
const validateInput = (value, type) => {
    if (!value || typeof value !== 'string') return null;
    
    // Basic sanitization - remove dangerous characters
    let sanitized = value.replace(/[<>\"'&]/g, '').trim();
    
    switch (type) {
        case 'projectId':
        case 'environment':
            // Allow alphanumeric, hyphens, underscores
            return sanitized.replace(/[^a-zA-Z0-9\-_]/g, '');
        case 'timestamp':
            // Basic timestamp validation
            return sanitized;
        default:
            return sanitized;
    }
};

/**
 * POST /api/v1/ip-report/generate
 * Generate IP access report using SQLite database
 */
router.post('/generate', conditionalAuth, async (req, res) => {
    const startTime = Date.now();
    
    try {
        console.log('[DEBUG] IP Report request received:', { body: req.body });
        const { projectId, environment, options = {} } = req.body;
        const userId = req.session?.user?.id || 'anonymous';
        console.log('[DEBUG] Extracted data:', { projectId, environment, options, userId });

        // Validate required parameters
        if (!projectId || !environment) {
            return res.status(400).json({
                error: 'projectId and environment are required'
            });
        }

        // Validate and sanitize inputs
        const sanitizedProjectId = validateInput(projectId, 'projectId');
        const sanitizedEnvironment = validateInput(environment, 'environment');

        if (!sanitizedProjectId || !sanitizedEnvironment) {
            return res.status(400).json({
                error: 'Invalid projectId or environment'
            });
        }

        // Validate and sanitize options
        const sanitizedOptions = {};
        console.log('[CUSTOM DATE RANGE DEBUG] Received options:', options);
        if (options.from) {
            sanitizedOptions.from = validateInput(options.from, 'timestamp');
            console.log('[CUSTOM DATE RANGE DEBUG] Sanitized from:', sanitizedOptions.from);
        }
        if (options.to) {
            sanitizedOptions.to = validateInput(options.to, 'timestamp');
            console.log('[CUSTOM DATE RANGE DEBUG] Sanitized to:', sanitizedOptions.to);
        }
        if (options.timeframe !== undefined) {
            const timeframe = parseInt(options.timeframe);
            if (!isNaN(timeframe) && timeframe >= 0 && timeframe <= 10080) { // Max 1 week
                sanitizedOptions.timeframe = timeframe;
            }
        }
        if (options.topIps !== undefined) {
            const topIps = parseInt(options.topIps);
            if (!isNaN(topIps) && topIps > 0 && topIps <= 100) { // Max 100 IPs
                sanitizedOptions.topIps = topIps;
            }
        }

        logger.info(`[IP REPORT API] User ${userId} requested IP report for ${sanitizedProjectId}/${sanitizedEnvironment}`);

        // Log the activity
        logActivity.custom('IP report generation requested', {
            userId,
            projectId: sanitizedProjectId,
            environment: sanitizedEnvironment,
            options: sanitizedOptions
        });

        // Get API token from session
        console.log('[IP REPORT DEBUG] Checking for API token in session...');
        console.log('[IP REPORT DEBUG] Session exists:', !!req.session);
        console.log('[IP REPORT DEBUG] Session keys:', req.session ? Object.keys(req.session) : 'N/A');
        
        const apiToken = req.session.decryptedApiToken;
        console.log('[IP REPORT DEBUG] API token found:', !!apiToken);

        if (!apiToken) {
            console.log('[IP REPORT DEBUG] No API token, returning 401');
            return res.status(401).json({
                error: 'API token is required'
            });
        }

        // Get WebSocket service for progress updates
        console.log('[IP REPORT DEBUG] Getting WebSocket service...');
        const wsService = WebSocketService; // Use the static class directly
        console.log('[IP REPORT DEBUG] WebSocket service obtained:', !!wsService);

        // Generate the report using V2 service
        console.log('[IP REPORT DEBUG] About to call generateIpReport with:', { 
            projectId: sanitizedProjectId, 
            environment: sanitizedEnvironment, 
            options: sanitizedOptions,
            hasApiToken: !!apiToken,
            userId 
        });
        
        const result = await ipReportService.generateIpReport(
            sanitizedProjectId,
            sanitizedEnvironment,
            sanitizedOptions,
            apiToken,
            userId,
            wsService
        );

        const processingTime = Date.now() - startTime;
        logger.info(`[IP REPORT API] Report generated successfully in ${processingTime}ms`);

        res.json(result);

    } catch (error) {
        logger.error('[IP REPORT API] Error generating report:', error);
        
        const statusCode = error.message.includes('authentication') ? 401
            : error.message.includes('No nodes found') ? 404
                : 500;

        res.status(statusCode).json({
            error: 'Failed to generate IP report',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/v1/ip-report/chart-data
 * Get chart data for specific IPs and time range
 */
router.get('/chart-data', conditionalAuth, async (req, res) => {
    try {
        const { projectId, environment, ips, startTime, endTime, bucketSize } = req.query;
        const userId = req.session?.user?.id || 'anonymous';

        // Validate required parameters
        if (!projectId || !environment || !ips || !startTime || !endTime) {
            return res.status(400).json({
                error: 'projectId, environment, ips, startTime, and endTime are required'
            });
        }

        // Validate and sanitize inputs
        const sanitizedProjectId = validateInput(projectId, 'projectId');
        const sanitizedEnvironment = validateInput(environment, 'environment');

        if (!sanitizedProjectId || !sanitizedEnvironment) {
            return res.status(400).json({
                error: 'Invalid projectId or environment'
            });
        }

        // Parse IPs array
        const ipArray = Array.isArray(ips) ? ips : ips.split(',').map(ip => ip.trim());
        
        // Parse timestamps
        const startTimestamp = parseInt(startTime);
        const endTimestamp = parseInt(endTime);
        const bucketSizeMinutes = parseInt(bucketSize) || 5;

        if (isNaN(startTimestamp) || isNaN(endTimestamp) || isNaN(bucketSizeMinutes)) {
            return res.status(400).json({
                error: 'Invalid timestamp or bucket size'
            });
        }

        logger.info(`[IP REPORT API] User ${userId} requested chart data for ${sanitizedProjectId}/${sanitizedEnvironment}`);

        // Get chart data from SQLite
        const timeSeriesData = await sqliteService.getTimeSeriesData(
            sanitizedProjectId,
            sanitizedEnvironment,
            ipArray,
            startTimestamp,
            endTimestamp,
            bucketSizeMinutes
        );

        res.json({
            success: true,
            data: {
                timeSeriesData,
                requestedIps: ipArray,
                timeRange: {
                    start: new Date(startTimestamp * 1000).toISOString(),
                    end: new Date(endTimestamp * 1000).toISOString()
                },
                bucketSizeMinutes
            }
        });

    } catch (error) {
        logger.error('[IP REPORT API] Error getting chart data:', error);
        
        res.status(500).json({
            error: 'Failed to get chart data',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/v1/ip-report/ip-details/:ip
 * Get detailed information for a specific IP
 */
router.get('/ip-details/:ip', conditionalAuth, async (req, res) => {
    try {
        console.log('[IP DETAILS DEBUG] Request received for IP:', req.params.ip);
        console.log('[IP DETAILS DEBUG] Query params:', req.query);
        
        const { projectId, environment, startTime, endTime } = req.query;
        const { ip } = req.params;
        const userId = req.session?.user?.id || 'anonymous';

        // Validate required parameters
        if (!projectId || !environment || !ip) {
            console.log('[IP DETAILS DEBUG] Missing required parameters');
            return res.status(400).json({
                error: 'projectId, environment, and ip are required'
            });
        }

        // Validate and sanitize inputs
        const sanitizedProjectId = validateInput(projectId, 'projectId');
        const sanitizedEnvironment = validateInput(environment, 'environment');
        const sanitizedIp = validateInput(ip, 'ip');

        if (!sanitizedProjectId || !sanitizedEnvironment || !sanitizedIp) {
            return res.status(400).json({
                error: 'Invalid projectId, environment, or IP'
            });
        }

        // Parse timestamps if provided
        let startTimestamp = null;
        let endTimestamp = null;
        
        if (startTime && endTime) {
            startTimestamp = parseInt(startTime);
            endTimestamp = parseInt(endTime);
            
            if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
                return res.status(400).json({
                    error: 'Invalid timestamp format'
                });
            }
        }

        logger.info(`[IP REPORT API] User ${userId} requested details for IP ${sanitizedIp} in ${sanitizedProjectId}/${sanitizedEnvironment}`);

        // Get IP details from SQLite
        console.log('[IP DETAILS DEBUG] Calling getIpDetails for:', sanitizedIp);
        const ipDetails = await sqliteService.getIpDetails(
            sanitizedProjectId,
            sanitizedEnvironment,
            sanitizedIp,
            startTimestamp,
            endTimestamp
        );
        
        console.log('[IP DETAILS DEBUG] IP details result:', {
            topUrlsCount: ipDetails.topUrls?.length || 0,
            userAgentsCount: ipDetails.userAgents?.length || 0,
            statusCodesCount: Object.keys(ipDetails.statusCodes || {}).length,
            methodsCount: Object.keys(ipDetails.methods || {}).length
        });

                 const response = {
            success: true,
            data: {
                ip: sanitizedIp,
                details: ipDetails,
                timeRange: startTimestamp && endTimestamp ? {
                    start: new Date(startTimestamp * 1000).toISOString(),
                    end: new Date(endTimestamp * 1000).toISOString()
                } : null
            }
        };
        
        console.log('[IP DETAILS DEBUG] Sending response with details');
        res.json(response);

    } catch (error) {
        logger.error('[IP REPORT API] Error getting IP details:', error);
        
        res.status(500).json({
            error: 'Failed to get IP details',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/v1/ip-report/urls/:ip
 * Get paginated URLs for a specific IP
 */
router.get('/urls/:ip', conditionalAuth, async (req, res) => {
    try {
        console.log('[IP URLS DEBUG] Request received for IP:', req.params.ip);
        console.log('[IP URLS DEBUG] Query params:', req.query);
        
        const { projectId, environment, startTime, endTime, page = 1, limit = 10 } = req.query;
        const { ip } = req.params;
        const userId = req.session?.user?.id || 'anonymous';

        // Validate required parameters
        if (!projectId || !environment || !ip) {
            console.log('[IP URLS DEBUG] Missing required parameters');
            return res.status(400).json({
                error: 'projectId, environment, and ip are required'
            });
        }

        // Validate and sanitize inputs
        const sanitizedProjectId = validateInput(projectId, 'projectId');
        const sanitizedEnvironment = validateInput(environment, 'environment');
        const sanitizedIp = validateInput(ip, 'ip');
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 10));
        const offset = (pageNum - 1) * limitNum;

        if (!sanitizedProjectId || !sanitizedEnvironment || !sanitizedIp) {
            return res.status(400).json({
                error: 'Invalid input parameters'
            });
        }

        // Parse timestamps if provided
        let startTimestamp = null;
        let endTimestamp = null;
        
        if (startTime && endTime) {
            startTimestamp = parseInt(startTime);
            endTimestamp = parseInt(endTime);
            
            if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
                return res.status(400).json({
                    error: 'Invalid timestamp format'
                });
            }
        }

        logger.info(`[IP REPORT API] User ${userId} requested URLs page ${pageNum} for IP ${sanitizedIp} in ${sanitizedProjectId}/${sanitizedEnvironment}`);

        // Get paginated URLs from SQLite
        console.log('[IP URLS DEBUG] Calling getIpUrls for:', sanitizedIp, 'page:', pageNum);
        const urlsData = await sqliteService.getIpUrls(
            sanitizedProjectId,
            sanitizedEnvironment,
            sanitizedIp,
            startTimestamp,
            endTimestamp,
            limitNum,
            offset
        );
        
        console.log('[IP URLS DEBUG] URLs result:', {
            urlsCount: urlsData.urls?.length || 0,
            totalCount: urlsData.total || 0,
            hasMore: urlsData.hasMore || false
        });

        res.json({
            success: true,
            data: {
                ip: sanitizedIp,
                urls: urlsData.urls,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: urlsData.total,
                    hasMore: urlsData.hasMore
                },
                timeRange: startTimestamp && endTimestamp ? {
                    start: new Date(startTimestamp * 1000).toISOString(),
                    end: new Date(endTimestamp * 1000).toISOString()
                } : null
            }
        });

    } catch (error) {
        logger.error('[IP REPORT API] Error getting IP URLs:', error);
        
        res.status(500).json({
            error: 'Failed to get IP URLs',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/v1/ip-report/user-agents/:ip
 * Get UserAgent data for a specific IP
 */
router.get('/user-agents/:ip', conditionalAuth, async (req, res) => {
    try {
        const { projectId, environment, startTime, endTime } = req.query;
        const { ip } = req.params;
        const userId = req.session?.user?.id || 'anonymous';

        // Validate required parameters
        if (!projectId || !environment || !ip) {
            return res.status(400).json({
                error: 'projectId, environment, and ip are required'
            });
        }

        // Validate and sanitize inputs
        const sanitizedProjectId = validateInput(projectId, 'projectId');
        const sanitizedEnvironment = validateInput(environment, 'environment');
        const sanitizedIp = validateInput(ip, 'ip');

        if (!sanitizedProjectId || !sanitizedEnvironment || !sanitizedIp) {
            return res.status(400).json({
                error: 'Invalid projectId, environment, or IP'
            });
        }

        // Parse timestamps if provided
        let startTimestamp = null;
        let endTimestamp = null;
        
        if (startTime && endTime) {
            startTimestamp = parseInt(startTime);
            endTimestamp = parseInt(endTime);
            
            if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
                return res.status(400).json({
                    error: 'Invalid timestamp format'
                });
            }
        }

        logger.info(`[IP REPORT API] User ${userId} requested UserAgent data for IP ${sanitizedIp} in ${sanitizedProjectId}/${sanitizedEnvironment}`);

        // Get UserAgent data from SQLite
        const userAgents = await sqliteService.getIpUserAgents(
            sanitizedProjectId,
            sanitizedEnvironment,
            sanitizedIp,
            startTimestamp,
            endTimestamp
        );

        res.json({
            success: true,
            data: {
                ip: sanitizedIp,
                userAgents,
                timeRange: startTimestamp && endTimestamp ? {
                    start: new Date(startTimestamp * 1000).toISOString(),
                    end: new Date(endTimestamp * 1000).toISOString()
                } : null
            }
        });

    } catch (error) {
        logger.error('[IP REPORT API] Error getting UserAgent data:', error);
        
        res.status(500).json({
            error: 'Failed to get UserAgent data',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/v1/ip-report/database-stats
 * Get database statistics for a project environment
 */
router.get('/database-stats', conditionalAuth, async (req, res) => {
    try {
        const { projectId, environment } = req.query;
        const userId = req.session?.user?.id || 'anonymous';

        // Validate required parameters
        if (!projectId || !environment) {
            return res.status(400).json({
                error: 'projectId and environment are required'
            });
        }

        // Validate and sanitize inputs
        const sanitizedProjectId = validateInput(projectId, 'projectId');
        const sanitizedEnvironment = validateInput(environment, 'environment');

        if (!sanitizedProjectId || !sanitizedEnvironment) {
            return res.status(400).json({
                error: 'Invalid projectId or environment'
            });
        }

        logger.info(`[IP REPORT API] User ${userId} requested database stats for ${sanitizedProjectId}/${sanitizedEnvironment}`);

        // Get database statistics
        const stats = await sqliteService.getDatabaseStats(sanitizedProjectId, sanitizedEnvironment);

        res.json({
            success: true,
            data: {
                projectId: sanitizedProjectId,
                environment: sanitizedEnvironment,
                stats
            }
        });

    } catch (error) {
        logger.error('[IP REPORT API] Error getting database stats:', error);
        
        res.status(500).json({
            error: 'Failed to get database statistics',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * DELETE /api/v1/ip-report/cleanup
 * Cleanup database and clear cached data for a project environment
 */
router.delete('/cleanup', conditionalAuth, async (req, res) => {
    try {
        console.log('[CLEANUP DEBUG] Request received');
        console.log('[CLEANUP DEBUG] Query params:', req.query);
        
        const { projectId, environment } = req.query;
        const userId = req.session?.user?.id || 'anonymous';

        // Validate required parameters
        if (!projectId || !environment) {
            console.log('[CLEANUP DEBUG] Missing required parameters');
            return res.status(400).json({
                error: 'projectId and environment are required'
            });
        }

        // Validate and sanitize inputs
        const sanitizedProjectId = validateInput(projectId, 'projectId');
        const sanitizedEnvironment = validateInput(environment, 'environment');

        if (!sanitizedProjectId || !sanitizedEnvironment) {
            return res.status(400).json({
                error: 'Invalid input parameters'
            });
        }

        logger.info(`[IP REPORT API] User ${userId} requested cleanup for ${sanitizedProjectId}/${sanitizedEnvironment}`);

        // Delete all SQLite database files (main db, shared memory, write-ahead log)
        const dbBasePath = `/tmp/access_logs-${sanitizedProjectId}-${sanitizedEnvironment}`;
        const dbFiles = [
            `${dbBasePath}.db`,
            `${dbBasePath}.db-shm`,
            `${dbBasePath}.db-wal`
        ];
        
        let deletedFiles = [];
        for (const filePath of dbFiles) {
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    deletedFiles.push(filePath);
                    console.log(`[CLEANUP DEBUG] Deleted file: ${filePath}`);
                } catch (error) {
                    console.log(`[CLEANUP DEBUG] Failed to delete file: ${filePath}`, error.message);
                }
            } else {
                console.log(`[CLEANUP DEBUG] File not found: ${filePath}`);
            }
        }
        
        console.log(`[CLEANUP DEBUG] Total files deleted: ${deletedFiles.length}`);

        // Close database connection if it exists
        await sqliteService.closeDatabase(sanitizedProjectId, sanitizedEnvironment);

        res.json({
            success: true,
            message: 'Database and cached data cleared successfully',
            data: {
                projectId: sanitizedProjectId,
                environment: sanitizedEnvironment,
                deletedFiles: deletedFiles,
                totalDeleted: deletedFiles.length
            }
        });

    } catch (error) {
        console.error('[CLEANUP DEBUG] Error:', error);
        logger.error(`[IP REPORT API] Error during cleanup:`, error);
        res.status(500).json({
            error: 'Failed to cleanup database',
            details: error.message
        });
    }
});

export default router; 