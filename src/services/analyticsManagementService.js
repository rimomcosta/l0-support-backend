// src/services/analyticsManagementService.js
import { UserActivityService } from './userActivityService.js';
import { logger } from './logger.js';

export class AnalyticsManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Build user session object from request
     * @param {Object} req - Express request object
     * @returns {Object} - User session object
     */
    buildUserSession(req) {
        return {
            id: req.session.user.id,
            sessionId: req.sessionID,
            groups: req.session.user.groups,
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
        };
    }

    /**
     * Track page view
     * @param {Object} req - Express request object
     * @param {Object} trackingData - Page view tracking data
     * @returns {Object} - Result with success or error
     */
    async trackPageView(req, trackingData) {
        try {
            const { page_name, page_url, project_id, environment } = trackingData;
            const userSession = this.buildUserSession(req);

            await UserActivityService.trackPageView(userSession, page_name, page_url, project_id, environment);
            
            return {
                success: true,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to track page view:', error);
            return {
                success: false,
                error: 'Failed to track page view',
                statusCode: 500
            };
        }
    }

    /**
     * Track project selection
     * @param {Object} req - Express request object
     * @param {Object} trackingData - Project selection tracking data
     * @returns {Object} - Result with success or error
     */
    async trackProjectSelection(req, trackingData) {
        try {
            const { project_id, environment } = trackingData;
            const userSession = this.buildUserSession(req);

            await UserActivityService.trackProjectSelection(userSession, project_id, environment);
            
            return {
                success: true,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to track project selection:', error);
            return {
                success: false,
                error: 'Failed to track project selection',
                statusCode: 500
            };
        }
    }

    /**
     * Track environment change
     * @param {Object} req - Express request object
     * @param {Object} trackingData - Environment change tracking data
     * @returns {Object} - Result with success or error
     */
    async trackEnvironmentChange(req, trackingData) {
        try {
            const { old_environment, new_environment, project_id } = trackingData;
            const userSession = this.buildUserSession(req);

            await UserActivityService.trackEnvironmentChange(userSession, old_environment, new_environment, project_id);
            
            return {
                success: true,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to track environment change:', error);
            return {
                success: false,
                error: 'Failed to track environment change',
                statusCode: 500
            };
        }
    }

    /**
     * Track project data fetch
     * @param {Object} req - Express request object
     * @param {Object} trackingData - Project data fetch tracking data
     * @returns {Object} - Result with success or error
     */
    async trackProjectDataFetch(req, trackingData) {
        try {
            const { project_id, environment, data_type } = trackingData;
            const userSession = this.buildUserSession(req);

            await UserActivityService.trackProjectDataFetch(userSession, project_id, environment, data_type);
            
            return {
                success: true,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to track project data fetch:', error);
            return {
                success: false,
                error: 'Failed to track project data fetch',
                statusCode: 500
            };
        }
    }

    /**
     * Track settings change
     * @param {Object} req - Express request object
     * @param {Object} trackingData - Settings change tracking data
     * @returns {Object} - Result with success or error
     */
    async trackSettingsChange(req, trackingData) {
        try {
            const { setting_type, old_value, new_value } = trackingData;
            const userSession = this.buildUserSession(req);

            await UserActivityService.trackSettingsChange(userSession, {
                setting_type,
                old_value,
                new_value
            });
            
            return {
                success: true,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to track settings change:', error);
            return {
                success: false,
                error: 'Failed to track settings change',
                statusCode: 500
            };
        }
    }

    /**
     * Track error
     * @param {Object} req - Express request object
     * @param {Object} trackingData - Error tracking data
     * @returns {Object} - Result with success or error
     */
    async trackError(req, trackingData) {
        try {
            const { error_type, error_message, error_context, project_id, environment } = trackingData;
            const userSession = this.buildUserSession(req);

            await UserActivityService.trackError(userSession, {
                error_type,
                error_message,
                error_context,
                project_id,
                environment
            });
            
            return {
                success: true,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to track error:', error);
            return {
                success: false,
                error: 'Failed to track error',
                statusCode: 500
            };
        }
    }
}
