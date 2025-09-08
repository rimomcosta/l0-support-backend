// src/api/core/adminAnalytics.js
import { AdminAnalyticsManagementService } from '../../services/adminAnalyticsManagementService.js';
import { logger } from '../../services/logger.js';

console.log('=== ADMIN ANALYTICS CONTROLLER LOADED ===');

/**
 * Get individual user details
 */
export async function getUserDetails(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getUserDetails(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getUserDetails:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get user analytics
 */
export async function getUserAnalytics(req, res) {
    try {
        const { userId } = req.params;
        const { timeRange = '30d' } = req.query;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getUserAnalytics(userId, timeRange);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getUserAnalytics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Update user information
 */
export async function updateUser(req, res) {
    try {
        const { userId } = req.params;
        const updateData = req.body;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.updateUser(userId, updateData);
        
        res.status(result.statusCode).json(result.success ? {
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in updateUser:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Revoke user API token
 */
export async function revokeUserToken(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.revokeUserToken(userId);
        
        res.status(result.statusCode).json(result.success ? {
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in revokeUserToken:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Delete user
 */
export async function deleteUser(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.deleteUser(userId);
        
        res.status(result.statusCode).json(result.success ? {
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in deleteUser:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get all users with analytics
 */
export async function getAllUsers(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getAllUsers();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getAllUsers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Test Elasticsearch connection
 */
export async function testElasticsearch(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.testElasticsearch();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error,
            details: result.details
        });
    } catch (error) {
        logger.error('Error in testElasticsearch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Test Elasticsearch search functionality
 */
export async function testElasticsearchSearch(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.testElasticsearchSearch();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error,
            details: result.details
        });
    } catch (error) {
        logger.error('Error in testElasticsearchSearch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get system overview
 */
export async function getSystemOverview(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getSystemOverview();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getSystemOverview:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get error tracking data
 */
export async function getErrorTracking(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getErrorTracking();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getErrorTracking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Resolve error
 */
export async function resolveError(req, res) {
    try {
        const { errorId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.resolveError(errorId);
        
        res.status(result.statusCode).json(result.success ? {
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in resolveError:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get most accessed pages
 */
export async function getMostAccessedPages(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getMostAccessedPages();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getMostAccessedPages:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get most active users
 */
export async function getMostActiveUsers(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getMostActiveUsers();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getMostActiveUsers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get most executed commands
 */
export async function getMostExecutedCommands(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getMostExecutedCommands();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getMostExecutedCommands:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get user timeline
 */
export async function getUserTimeline(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getUserTimeline(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getUserTimeline:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get project usage
 */
export async function getProjectUsage(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getProjectUsage();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getProjectUsage:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get realtime metrics
 */
export async function getRealtimeMetrics(req, res) {
    try {
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getRealtimeMetrics();
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getRealtimeMetrics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get user activities
 */
export async function getUserActivities(req, res) {
    try {
        const { userId } = req.params;
        const filters = req.query;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getUserActivities(userId, filters);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getUserActivities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get user errors
 */
export async function getUserErrors(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getUserErrors(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getUserErrors:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get user sessions
 */
export async function getUserSessions(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.getUserSessions(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in getUserSessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Delete user activities
 */
export async function deleteUserActivities(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.deleteUserActivities(userId);
        
        res.status(result.statusCode).json(result.success ? {
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in deleteUserActivities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Resolve error by ID
 */
export async function resolveErrorById(req, res) {
    try {
        const { errorId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.resolveErrorById(errorId);
        
        res.status(result.statusCode).json(result.success ? {
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in resolveErrorById:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Export user data
 */
export async function exportUserData(req, res) {
    try {
        const { userId } = req.params;
        
        const adminService = new AdminAnalyticsManagementService();
        const result = await adminService.exportUserData(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error('Error in exportUserData:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}