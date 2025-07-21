import express from 'express';
import { ipReportService } from '../services/ipReportService.js';
import { logger } from '../services/logger.js';
import { logActivity } from '../services/activityLogger.js';
import { requireAuth } from '../middleware/auth.js';
import { WebSocketService } from '../services/webSocketService.js';

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
 * POST /api/ip-report/generate
 * Generate IP access report for a project environment
 */
router.post('/generate', requireAuth, async (req, res) => {
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
        if (options.from) {
            sanitizedOptions.from = validateInput(options.from, 'timestamp');
        }
        if (options.to) {
            sanitizedOptions.to = validateInput(options.to, 'timestamp');
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

        console.log('[DEBUG] About to log activity for userId:', userId);
        // Log the activity
        logActivity.custom('IP report generation requested', {
            userId,
            projectId: sanitizedProjectId,
            environment: sanitizedEnvironment,
            options: sanitizedOptions
        });
        console.log('[DEBUG] Activity logged successfully');

        // Get API token and user ID from session
        const apiToken = req.session.decryptedApiToken;
        const userIdFromSession = req.session?.user?.id;

        if (!apiToken) {
            return res.status(401).json({
                error: 'API token is required'
            });
        }

        // Generate the report with WebSocket progress updates
        const result = await ipReportService.generateIpReport(
            sanitizedProjectId,
            sanitizedEnvironment,
            sanitizedOptions,
            apiToken,
            userIdFromSession,
            WebSocketService
        );

        const processingTime = Date.now() - startTime;
        
        if (result.success) {
            logger.info(`[IP REPORT API] Report generated successfully for ${sanitizedProjectId}/${sanitizedEnvironment} in ${processingTime}ms`);
            
            res.json({
                success: true,
                data: result.data,
                metadata: {
                    requestTime: new Date().toISOString(),
                    processingTimeMs: processingTime,
                    projectId: sanitizedProjectId,
                    environment: sanitizedEnvironment
                }
            });
        } else {
            logger.error(`[IP REPORT API] Report generation failed for ${sanitizedProjectId}/${sanitizedEnvironment}:`, result.error);
            
            res.status(500).json({
                success: false,
                error: result.error,
                metadata: {
                    requestTime: new Date().toISOString(),
                    processingTimeMs: processingTime,
                    projectId: sanitizedProjectId,
                    environment: sanitizedEnvironment
                }
            });
        }

    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.log('[DEBUG] Caught error in route:', error);
        logger.error(`[IP REPORT API] Unexpected error:`, error);
        console.error('[IP REPORT API] Unexpected error:', error);
        
        res.status(500).json({
            success: false,
            error: 'Internal server error while generating IP report',
            metadata: {
                requestTime: new Date().toISOString(),
                processingTimeMs: processingTime
            }
        });
    }
});

/**
 * GET /api/ip-report/status
 * Check if IP report generation is available
 */
router.get('/status', async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                available: true,
                supportedFormats: ['json'],
                maxTimeframeMinutes: 10080, // 1 week
                maxTopIps: 100,
                description: 'IP access report generation from Magento Cloud access logs'
            }
        });
    } catch (error) {
        logger.error(`[IP REPORT API] Error checking status:`, error);
        res.status(500).json({
            success: false,
            error: 'Error checking IP report status'
        });
    }
});

export default router; 