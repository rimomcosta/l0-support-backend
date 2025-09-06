// src/api/app/ipReport.js
import { IpReportManagementService } from '../../services/ipReportManagementService.js';

/**
 * Generate IP access report using SQLite database
 */
export async function generateReport(req, res) {
    const { projectId, environment, options = {} } = req.body;
    const userId = req.session?.user?.id || 'anonymous';
    const apiToken = req.session.decryptedApiToken;

    try {
        // Delegate to service
        const ipReportService = new IpReportManagementService();
        const result = await ipReportService.generateReport(projectId, environment, options, apiToken, userId);

        res.status(result.statusCode).json(result.success ? result : {
            error: result.error,
            details: result.details,
            timestamp: result.timestamp
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get chart data for specific IPs and time range
 */
export async function getChartData(req, res) {
    const { projectId, environment, ips, startTime, endTime, bucketSize } = req.query;
    const userId = req.session?.user?.id || 'anonymous';

    try {
        // Delegate to service
        const ipReportService = new IpReportManagementService();
        const result = await ipReportService.getChartData(projectId, environment, ips, startTime, endTime, bucketSize, userId);

        res.status(result.statusCode).json(result.success ? {
            success: true,
            data: result.data
        } : {
            error: result.error,
            details: result.details,
            timestamp: result.timestamp
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get paginated IP details with optional filters
 */
export async function getIpDetails(req, res) {
    const { projectId, environment, startTime, endTime, statusCode, method, url, userAgent, lastTimestamp } = req.query;
    const { ip } = req.params;
    const userId = req.session?.user?.id || 'anonymous';

    try {
        // Parse timestamps if provided
        let startTimestamp = null;
        let endTimestamp = null;
        let parsedLastTimestamp = null;
        
        if (startTime && endTime) {
            startTimestamp = parseInt(startTime);
            endTimestamp = parseInt(endTime);
            
            if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
                return res.status(400).json({
                    error: 'Invalid timestamp format'
                });
            }
        }

        if (lastTimestamp) {
            parsedLastTimestamp = parseInt(lastTimestamp);
            if (isNaN(parsedLastTimestamp)) {
                return res.status(400).json({
                    error: 'Invalid lastTimestamp format'
                });
            }
        }

        // Build filters object
        const filters = {};
        if (statusCode) filters.statusCode = statusCode;
        if (method) filters.method = method;
        if (url) filters.url = url;
        if (userAgent) filters.userAgent = userAgent;

        // Delegate to service
        const ipReportService = new IpReportManagementService();
        const result = await ipReportService.getIpDetails(projectId, environment, ip, {
            startTimestamp,
            endTimestamp,
            filters,
            lastTimestamp: parsedLastTimestamp
        }, userId);

        res.status(result.statusCode).json(result.success ? {
            success: true,
            data: result.data
        } : {
            error: result.error,
            details: result.details,
            timestamp: result.timestamp
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get paginated URLs for a specific IP
 */
export async function getIpUrls(req, res) {
    const { projectId, environment, startTime, endTime, page = 1, limit = 10 } = req.query;
    const { ip } = req.params;
    const userId = req.session?.user?.id || 'anonymous';

    try {
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

        // Delegate to service
        const ipReportService = new IpReportManagementService();
        const result = await ipReportService.getIpUrls(projectId, environment, ip, {
            page,
            limit,
            startTimestamp,
            endTimestamp
        }, userId);

        res.status(result.statusCode).json(result.success ? {
            success: true,
            data: result.data
        } : {
            error: result.error,
            details: result.details,
            timestamp: result.timestamp
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Get UserAgent data for a specific IP
 */
export async function getIpUserAgents(req, res) {
    const { projectId, environment, startTime, endTime } = req.query;
    const { ip } = req.params;
    const userId = req.session?.user?.id || 'anonymous';

    try {
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

        // Delegate to service
        const ipReportService = new IpReportManagementService();
        const result = await ipReportService.getIpUserAgents(projectId, environment, ip, {
            startTimestamp,
            endTimestamp
        }, userId);

        res.status(result.statusCode).json(result.success ? {
            success: true,
            data: result.data
        } : {
            error: result.error,
            details: result.details,
            timestamp: result.timestamp
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Cleanup database and clear cached data for a project environment
 */
export async function cleanupData(req, res) {
    const { projectId, environment } = req.query;
    const userId = req.session?.user?.id || 'anonymous';

    try {
        // Delegate to service
        const ipReportService = new IpReportManagementService();
        const result = await ipReportService.cleanupData(projectId, environment, userId);

        res.status(result.statusCode).json(result.success ? {
            success: result.success,
            message: result.message,
            data: result.data
        } : {
            error: result.error,
            details: result.details
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
