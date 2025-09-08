// src/services/tunnelManagementService.js
import { tunnelManager } from './tunnelService.js';
import { logger } from './logger.js';

export class TunnelManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate tunnel parameters
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Object} - Validation result
     */
    validateTunnelParams(projectId, environment, apiToken, userId) {
        if (!projectId || !environment || !apiToken || !userId) {
            return {
                valid: false,
                error: 'Missing required parameters: projectId, environment, apiToken, or userId'
            };
        }
        return { valid: true };
    }

    /**
     * Open tunnel for project/environment
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Object} - Result with tunnel info or error
     */
    async openTunnel(projectId, environment, apiToken, userId) {
        try {
            const validation = this.validateTunnelParams(projectId, environment, apiToken, userId);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error,
                    statusCode: 400
                };
            }

            const tunnelInfo = await tunnelManager.openTunnel(projectId, environment, apiToken, userId);

            return {
                success: true,
                tunnelInfo,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to open tunnel:', {
                error: error.message,
                projectId,
                environment,
                userId
            });

            return {
                success: false,
                error: 'Failed to open tunnel',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                statusCode: 500
            };
        }
    }
}
