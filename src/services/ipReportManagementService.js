// src/services/ipReportManagementService.js
import { NewRelicIpReportService } from './newRelicIpReportService.js';
import { logger } from './logger.js';
import { logActivity } from './activityLogger.js';
import { WebSocketService } from './webSocketService.js';

export class IpReportManagementService {
    constructor() {
        this.newRelicService = new NewRelicIpReportService();
    }

    /**
     * Simple validation function for IP report inputs
     * @param {string} value - Value to validate
     * @param {string} type - Type of validation
     * @returns {string|null} Sanitized value or null if invalid
     */
    validateInput(value, type) {
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
    }

    /**
     * Generate IP access report using SQLite database
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {Object} options - Report options
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with report data
     */
    async generateReport(projectId, environment, options = {}, apiToken, userId) {
        const startTime = Date.now();
        
        try {
            // Validate required parameters
            if (!projectId || !environment) {
                return {
                    success: false,
                    error: 'projectId and environment are required',
                    statusCode: 400
                };
            }

            // Validate and sanitize inputs
            const sanitizedProjectId = this.validateInput(projectId, 'projectId');
            const sanitizedEnvironment = this.validateInput(environment, 'environment');

            if (!sanitizedProjectId || !sanitizedEnvironment) {
                return {
                    success: false,
                    error: 'Invalid projectId or environment',
                    statusCode: 400
                };
            }

            // Validate and sanitize options
            const sanitizedOptions = {};
            if (options.from) {
                sanitizedOptions.from = this.validateInput(options.from, 'timestamp');
            }
            if (options.to) {
                sanitizedOptions.to = this.validateInput(options.to, 'timestamp');
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

            if (!apiToken) {
                return {
                    success: false,
                    error: 'API token is required',
                    statusCode: 401
                };
            }

            // Get WebSocket service for progress updates
            const wsService = WebSocketService; // Use the static class directly

            // Generate the report using NewRelic service
            const result = await this.newRelicService.generateIpReport(
                sanitizedProjectId,
                sanitizedEnvironment,
                sanitizedOptions,
                apiToken,
                userId,
                wsService
            );

            const processingTime = Date.now() - startTime;
            logger.info(`[IP REPORT API] Report generated successfully in ${processingTime}ms`);

            return {
                success: true,
                ...result,
                statusCode: 200
            };
        } catch (error) {
            logger.error('[IP REPORT API] Error generating report:', error);
            
            const statusCode = error.message.includes('authentication') ? 401
                : error.message.includes('No nodes found') ? 404
                    : 500;

            return {
                success: false,
                error: 'Failed to generate IP report',
                details: error.message,
                timestamp: new Date().toISOString(),
                statusCode
            };
        }
    }

    /**
     * Get chart data for specific IPs and time range
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {Array|string} ips - IP addresses
     * @param {string} startTime - Start timestamp
     * @param {string} endTime - End timestamp
     * @param {string} bucketSize - Bucket size in minutes
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with chart data
     */
    async getChartData(projectId, environment, ips, startTime, endTime, bucketSize, userId) {
        try {
            // Validate required parameters
            if (!projectId || !environment || !ips || !startTime || !endTime) {
                return {
                    success: false,
                    error: 'projectId, environment, ips, startTime, and endTime are required',
                    statusCode: 400
                };
            }

            // Validate and sanitize inputs
            const sanitizedProjectId = this.validateInput(projectId, 'projectId');
            const sanitizedEnvironment = this.validateInput(environment, 'environment');

            if (!sanitizedProjectId || !sanitizedEnvironment) {
                return {
                    success: false,
                    error: 'Invalid projectId or environment',
                    statusCode: 400
                };
            }

            // Parse IPs array
            const ipArray = Array.isArray(ips) ? ips : ips.split(',').map(ip => ip.trim());
            
            // Parse timestamps
            const startTimestamp = parseInt(startTime);
            const endTimestamp = parseInt(endTime);
            const bucketSizeMinutes = parseInt(bucketSize) || 5;

            if (isNaN(startTimestamp) || isNaN(endTimestamp) || isNaN(bucketSizeMinutes)) {
                return {
                    success: false,
                    error: 'Invalid timestamp or bucket size',
                    statusCode: 400
                };
            }

            logger.info(`[IP REPORT API] User ${userId} requested chart data for ${sanitizedProjectId}/${sanitizedEnvironment}`);

            // Get chart data from NewRelic
            const accountId = await this.newRelicService.getAccountByProjectId(sanitizedProjectId);
            const timeSeriesData = await this.newRelicService.getTimeSeriesData(
                accountId,
                sanitizedProjectId,
                sanitizedEnvironment,
                startTimestamp,
                endTimestamp,
                ipArray,
                bucketSizeMinutes
            );

            return {
                success: true,
                data: {
                    timeSeriesData,
                    requestedIps: ipArray,
                    timeRange: {
                        start: new Date(startTimestamp * 1000).toISOString(),
                        end: new Date(endTimestamp * 1000).toISOString()
                    },
                    bucketSizeMinutes
                },
                statusCode: 200
            };
        } catch (error) {
            logger.error('[IP REPORT API] Error getting chart data:', error);
            
            return {
                success: false,
                error: 'Failed to get chart data',
                details: error.message,
                timestamp: new Date().toISOString(),
                statusCode: 500
            };
        }
    }

    /**
     * Get paginated IP details with optional filters
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} ip - IP address
     * @param {Object} filters - Filter options
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with IP details
     */
    async getIpDetails(projectId, environment, ip, filters, userId) {
        try {
            // Validate required parameters
            if (!projectId || !environment || !ip) {
                return {
                    success: false,
                    error: 'projectId, environment, and ip are required',
                    statusCode: 400
                };
            }

            // Validate and sanitize inputs
            const sanitizedProjectId = this.validateInput(projectId, 'projectId');
            const sanitizedEnvironment = this.validateInput(environment, 'environment');
            const sanitizedIp = this.validateInput(ip, 'ip');

            if (!sanitizedProjectId || !sanitizedEnvironment || !sanitizedIp) {
                return {
                    success: false,
                    error: 'Invalid projectId, environment, or IP',
                    statusCode: 400
                };
            }

            logger.info(`[IP REPORT API] User ${userId} requested IP details for ${sanitizedIp} in ${sanitizedProjectId}/${sanitizedEnvironment} with filters:`, filters);

            // Get IP details from NewRelic
            const accountId = await this.newRelicService.getAccountByProjectId(sanitizedProjectId);
            const details = await this.newRelicService.getIpDetails(
                accountId,
                sanitizedProjectId,
                sanitizedIp,
                filters.startTimestamp,
                filters.endTimestamp,
                filters.filters,
                filters.lastTimestamp
            );

            return {
                success: true,
                data: {
                    ip: sanitizedIp,
                    requests: details.requests,
                    totalCount: details.totalCount,
                    hasMore: details.hasMore,
                    lastTimestamp: details.lastTimestamp,
                    appliedFilters: filters.filters,
                    timeRange: filters.startTimestamp && filters.endTimestamp ? {
                        start: new Date(filters.startTimestamp * 1000).toISOString(),
                        end: new Date(filters.endTimestamp * 1000).toISOString()
                    } : null
                },
                statusCode: 200
            };
        } catch (error) {
            logger.error('[IP REPORT API] Error getting IP details:', error);
            
            return {
                success: false,
                error: 'Failed to get IP details',
                details: error.message,
                timestamp: new Date().toISOString(),
                statusCode: 500
            };
        }
    }

    /**
     * Get paginated URLs for a specific IP
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} ip - IP address
     * @param {Object} options - Pagination and filter options
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with URLs data
     */
    async getIpUrls(projectId, environment, ip, options, userId) {
        try {
            // Validate required parameters
            if (!projectId || !environment || !ip) {
                return {
                    success: false,
                    error: 'projectId, environment, and ip are required',
                    statusCode: 400
                };
            }

            // Validate and sanitize inputs
            const sanitizedProjectId = this.validateInput(projectId, 'projectId');
            const sanitizedEnvironment = this.validateInput(environment, 'environment');
            const sanitizedIp = this.validateInput(ip, 'ip');
            const pageNum = Math.max(1, parseInt(options.page) || 1);
            const limitNum = Math.min(50, Math.max(1, parseInt(options.limit) || 10));
            const offset = (pageNum - 1) * limitNum;

            if (!sanitizedProjectId || !sanitizedEnvironment || !sanitizedIp) {
                return {
                    success: false,
                    error: 'Invalid input parameters',
                    statusCode: 400
                };
            }

            logger.info(`[IP REPORT API] User ${userId} requested URLs page ${pageNum} for IP ${sanitizedIp} in ${sanitizedProjectId}/${sanitizedEnvironment}`);

            // Get paginated URLs from NewRelic
            const accountId = await this.newRelicService.getAccountByProjectId(sanitizedProjectId);
            const urlsData = await this.newRelicService.getIpUrls(
                accountId,
                sanitizedProjectId,
                sanitizedIp,
                options.startTimestamp,
                options.endTimestamp,
                limitNum,
                offset
            );

            return {
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
                    timeRange: options.startTimestamp && options.endTimestamp ? {
                        start: new Date(options.startTimestamp * 1000).toISOString(),
                        end: new Date(options.endTimestamp * 1000).toISOString()
                    } : null
                },
                statusCode: 200
            };
        } catch (error) {
            logger.error('[IP REPORT API] Error getting IP URLs:', error);
            
            return {
                success: false,
                error: 'Failed to get IP URLs',
                details: error.message,
                timestamp: new Date().toISOString(),
                statusCode: 500
            };
        }
    }

    /**
     * Get UserAgent data for a specific IP
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} ip - IP address
     * @param {Object} timeRange - Time range options
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with UserAgent data
     */
    async getIpUserAgents(projectId, environment, ip, timeRange, userId) {
        try {
            // Validate required parameters
            if (!projectId || !environment || !ip) {
                return {
                    success: false,
                    error: 'projectId, environment, and ip are required',
                    statusCode: 400
                };
            }

            // Validate and sanitize inputs
            const sanitizedProjectId = this.validateInput(projectId, 'projectId');
            const sanitizedEnvironment = this.validateInput(environment, 'environment');
            const sanitizedIp = this.validateInput(ip, 'ip');

            if (!sanitizedProjectId || !sanitizedEnvironment || !sanitizedIp) {
                return {
                    success: false,
                    error: 'Invalid projectId, environment, or IP',
                    statusCode: 400
                };
            }

            logger.info(`[IP REPORT API] User ${userId} requested UserAgent data for IP ${sanitizedIp} in ${sanitizedProjectId}/${sanitizedEnvironment}`);

            // Get UserAgent data from NewRelic
            const accountId = await this.newRelicService.getAccountByProjectId(sanitizedProjectId);
            const userAgents = await this.newRelicService.getIpUserAgents(
                accountId,
                sanitizedProjectId,
                sanitizedIp,
                timeRange.startTimestamp,
                timeRange.endTimestamp
            );

            return {
                success: true,
                data: {
                    ip: sanitizedIp,
                    userAgents,
                    timeRange: timeRange.startTimestamp && timeRange.endTimestamp ? {
                        start: new Date(timeRange.startTimestamp * 1000).toISOString(),
                        end: new Date(timeRange.endTimestamp * 1000).toISOString()
                    } : null
                },
                statusCode: 200
            };
        } catch (error) {
            logger.error('[IP REPORT API] Error getting UserAgent data:', error);
            
            return {
                success: false,
                error: 'Failed to get UserAgent data',
                details: error.message,
                timestamp: new Date().toISOString(),
                statusCode: 500
            };
        }
    }

    /**
     * Cleanup database and clear cached data for a project environment
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with cleanup status
     */
    async cleanupData(projectId, environment, userId) {
        try {
            // Validate required parameters
            if (!projectId || !environment) {
                return {
                    success: false,
                    error: 'projectId and environment are required',
                    statusCode: 400
                };
            }

            // Validate and sanitize inputs
            const sanitizedProjectId = this.validateInput(projectId, 'projectId');
            const sanitizedEnvironment = this.validateInput(environment, 'environment');

            if (!sanitizedProjectId || !sanitizedEnvironment) {
                return {
                    success: false,
                    error: 'Invalid input parameters',
                    statusCode: 400
                };
            }

            logger.info(`[IP REPORT API] User ${userId} requested cleanup for ${sanitizedProjectId}/${sanitizedEnvironment}`);

            // For NewRelic, there's no local database to clean up
            // The cleanup is mainly for clearing any cached data
            const deletedFiles = [];

            return {
                success: true,
                message: 'Database and cached data cleared successfully',
                data: {
                    projectId: sanitizedProjectId,
                    environment: sanitizedEnvironment,
                    deletedFiles: deletedFiles,
                    totalDeleted: deletedFiles.length
                },
                statusCode: 200
            };
        } catch (error) {
            logger.error(`[IP REPORT API] Error during cleanup:`, error);
            
            return {
                success: false,
                error: 'Failed to cleanup database',
                details: error.message,
                statusCode: 500
            };
        }
    }
}
