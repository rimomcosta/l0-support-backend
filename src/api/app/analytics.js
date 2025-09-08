// src/api/app/analytics.js
import { AnalyticsManagementService } from '../../services/analyticsManagementService.js';
import { logger } from '../../services/logger.js';

// Track page view
export async function trackPageView(req, res) {
    try {
        const { page_name, page_url, project_id, environment } = req.body;
        
        const analyticsService = new AnalyticsManagementService();
        const result = await analyticsService.trackPageView(req, {
            page_name, page_url, project_id, environment
        });
        
        res.status(result.statusCode).json(result.success ? { success: true } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Failed to track page view:', error);
        res.status(500).json({ error: 'Failed to track page view' });
    }
}

// Track project selection
export async function trackProjectSelection(req, res) {
    try {
        const { project_id, environment } = req.body;
        
        const analyticsService = new AnalyticsManagementService();
        const result = await analyticsService.trackProjectSelection(req, {
            project_id, environment
        });
        
        res.status(result.statusCode).json(result.success ? { success: true } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Failed to track project selection:', error);
        res.status(500).json({ error: 'Failed to track project selection' });
    }
}

// Track environment change
export async function trackEnvironmentChange(req, res) {
    try {
        const { old_environment, new_environment, project_id } = req.body;
        
        const analyticsService = new AnalyticsManagementService();
        const result = await analyticsService.trackEnvironmentChange(req, {
            old_environment, new_environment, project_id
        });
        
        res.status(result.statusCode).json(result.success ? { success: true } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Failed to track environment change:', error);
        res.status(500).json({ error: 'Failed to track environment change' });
    }
}

// Track project data fetch
export async function trackProjectDataFetch(req, res) {
    try {
        const { project_id, environment, data_type } = req.body;
        
        const analyticsService = new AnalyticsManagementService();
        const result = await analyticsService.trackProjectDataFetch(req, {
            project_id, environment, data_type
        });
        
        res.status(result.statusCode).json(result.success ? { success: true } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Failed to track project data fetch:', error);
        res.status(500).json({ error: 'Failed to track project data fetch' });
    }
}

// Track settings change
export async function trackSettingsChange(req, res) {
    try {
        const { setting_type, old_value, new_value } = req.body;
        
        const analyticsService = new AnalyticsManagementService();
        const result = await analyticsService.trackSettingsChange(req, {
            setting_type, old_value, new_value
        });
        
        res.status(result.statusCode).json(result.success ? { success: true } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Failed to track settings change:', error);
        res.status(500).json({ error: 'Failed to track settings change' });
    }
}

// Track error
export async function trackError(req, res) {
    try {
        const { error_type, error_message, error_context, project_id, environment } = req.body;
        
        const analyticsService = new AnalyticsManagementService();
        const result = await analyticsService.trackError(req, {
            error_type, error_message, error_context, project_id, environment
        });
        
        res.status(result.statusCode).json(result.success ? { success: true } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Failed to track error:', error);
        res.status(500).json({ error: 'Failed to track error' });
    }
}
