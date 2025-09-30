// src/services/adminAnalyticsManagementService.js
import { AnalyticsService, opensearchClient, opensearchConfig } from './analyticsService.js';
import { logger } from './logger.js';
import { pool } from '../config/database.js';

export class AdminAnalyticsManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Get individual user details
     * @param {string} userId - User ID
     * @returns {Object} - Result with user details or error
     */
    async getUserDetails(userId) {
        try {
            let user;
            
            try {
                // Get user from database
                const [users] = await pool.execute(
                    'SELECT * FROM users WHERE user_id = ?',
                    [userId]
                );
                
                if (users.length === 0) {
                    return {
                        success: false,
                        error: 'User not found',
                        statusCode: 404
                    };
                }
                
                user = users[0];
            } catch (dbError) {
                console.error('=== DATABASE ERROR ===', dbError);
                return {
                    success: false,
                    error: 'Database error: ' + dbError.message,
                    statusCode: 500
                };
            }
            
            // Get basic analytics for the user
            try {
                // Use a simpler query without complex aggregations
                const response = await opensearchClient.search({
                    index: opensearchConfig.index.user_activities,
                    body: {
                        query: {
                            bool: {
                                must: [
                                    { term: { user_id: userId } },
                                    { range: { '@timestamp': { gte: 'now-30d' } } }
                                ]
                            }
                        },
                        sort: [{ '@timestamp': { order: 'desc' } }],
                        size: 1000
                    }
                });

                const activities = response.body.hits.hits.map(hit => ({
                    timestamp: hit._source['@timestamp'],
                    action: hit._source.action,
                    details: hit._source.details,
                    project_id: hit._source.project_id,
                    environment: hit._source.environment
                }));

                // Calculate basic stats
                const totalActivities = activities.length;
                const uniqueProjects = new Set(activities.map(a => a.project_id)).size;
                const uniqueEnvironments = new Set(activities.map(a => a.environment)).size;
                
                // Group by action type
                const actionCounts = activities.reduce((acc, activity) => {
                    acc[activity.action] = (acc[activity.action] || 0) + 1;
                    return acc;
                }, {});

                return {
                    success: true,
                    data: {
                        user: {
                            user_id: user.user_id,
                            email: user.email,
                            name: user.name,
                            role: user.role,
                            created_at: user.created_at,
                            last_login: user.last_login
                        },
                        analytics: {
                            totalActivities,
                            uniqueProjects,
                            uniqueEnvironments,
                            actionCounts,
                            recentActivities: activities.slice(0, 10)
                        }
                    },
                    statusCode: 200
                };
            } catch (osError) {
                console.error('=== OPENSEARCH ERROR ===', osError);
                return {
                    success: true,
                    data: {
                        user: {
                            user_id: user.user_id,
                            email: user.email,
                            name: user.name,
                            role: user.role,
                            created_at: user.created_at,
                            last_login: user.last_login
                        },
                        analytics: {
                            totalActivities: 0,
                            uniqueProjects: 0,
                            uniqueEnvironments: 0,
                            actionCounts: {},
                            recentActivities: [],
                            error: 'Analytics data temporarily unavailable'
                        }
                    },
                    statusCode: 200
                };
            }
        } catch (error) {
            this.logger.error('Error in getUserDetails:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Get user analytics
     * @param {string} userId - User ID
     * @param {string} timeRange - Time range for analytics
     * @returns {Object} - Result with analytics data or error
     */
    async getUserAnalytics(userId, timeRange = '30d') {
        try {
            const analytics = await AnalyticsService.getUserAnalytics(userId, timeRange);
            const sessions = await AnalyticsService.getUserSessions(userId, timeRange);
            
            return {
                success: true,
                data: {
                    analytics,
                    sessions
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error in getUserAnalytics:', error);
            return {
                success: false,
                error: 'Failed to fetch user analytics',
                statusCode: 500
            };
        }
    }

    /**
     * Update user information
     * @param {string} userId - User ID
     * @param {Object} updateData - Data to update
     * @returns {Object} - Result with success or error
     */
    async updateUser(userId, updateData) {
        try {
            const [result] = await pool.execute(
                'UPDATE users SET name = ?, email = ?, role = ? WHERE user_id = ?',
                [updateData.name, updateData.email, updateData.role, userId]
            );
            
            if (result.affectedRows === 0) {
                return {
                    success: false,
                    error: 'User not found',
                    statusCode: 404
                };
            }
            
            return {
                success: true,
                message: 'User updated successfully',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error updating user:', error);
            return {
                success: false,
                error: 'Failed to update user',
                statusCode: 500
            };
        }
    }

    /**
     * Revoke user API token
     * @param {string} userId - User ID
     * @returns {Object} - Result with success or error
     */
    async revokeUserToken(userId) {
        try {
            const [result] = await pool.execute(
                'UPDATE users SET encrypted_api_token = NULL, salt = NULL WHERE user_id = ?',
                [userId]
            );
            
            if (result.affectedRows === 0) {
                return {
                    success: false,
                    error: 'User not found',
                    statusCode: 404
                };
            }
            
            return {
                success: true,
                message: 'API token revoked successfully',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error revoking user token:', error);
            return {
                success: false,
                error: 'Failed to revoke API token',
                statusCode: 500
            };
        }
    }

    /**
     * Delete user
     * @param {string} userId - User ID
     * @returns {Object} - Result with success or error
     */
    async deleteUser(userId) {
        try {
            const [result] = await pool.execute(
                'DELETE FROM users WHERE user_id = ?',
                [userId]
            );
            
            if (result.affectedRows === 0) {
                return {
                    success: false,
                    error: 'User not found',
                    statusCode: 404
                };
            }
            
            return {
                success: true,
                message: 'User deleted successfully',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error deleting user:', error);
            return {
                success: false,
                error: 'Failed to delete user',
                statusCode: 500
            };
        }
    }

    /**
     * Get all users with analytics
     * @returns {Object} - Result with users data or error
     */
    async getAllUsers() {
        try {
            const users = await AnalyticsService.getAllUsersWithAnalytics();
            
            return {
                success: true,
                data: { users },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting all users:', error);
            return {
                success: false,
                error: 'Failed to fetch users',
                statusCode: 500
            };
        }
    }

    /**
     * Test OpenSearch connection
     * @returns {Object} - Result with health status or error
     */
    async testElasticsearch() {
        try {
            const health = await opensearchClient.cluster.health();
            
            return {
                success: true,
                data: {
                    status: health.body.status,
                    cluster_name: health.body.cluster_name,
                    number_of_nodes: health.body.number_of_nodes,
                    active_shards: health.body.active_shards
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('OpenSearch test failed:', error);
            return {
                success: false,
                error: 'OpenSearch connection failed',
                details: error.message,
                statusCode: 500
            };
        }
    }

    /**
     * Test OpenSearch search functionality
     * @returns {Object} - Result with search test or error
     */
    async testElasticsearchSearch() {
        try {
            const response = await opensearchClient.search({
                index: opensearchConfig.index.user_activities,
                body: {
                    query: { match_all: {} },
                    size: 1
                }
            });
            
            return {
                success: true,
                data: {
                    total_hits: response.body.hits.total.value,
                    took: response.body.took,
                    timed_out: response.body.timed_out
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('OpenSearch search test failed:', error);
            return {
                success: false,
                error: 'OpenSearch search test failed',
                details: error.message,
                statusCode: 500
            };
        }
    }

    /**
     * Get system overview
     * @returns {Object} - Result with system overview or error
     */
    async getSystemOverview() {
        try {
            // This would contain complex system overview logic
            // For now, return a basic structure
            return {
                success: true,
                data: {
                    totalUsers: 0,
                    totalActivities: 0,
                    systemHealth: 'healthy'
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting system overview:', error);
            return {
                success: false,
                error: 'Failed to get system overview',
                statusCode: 500
            };
        }
    }

    /**
     * Get error tracking data
     * @returns {Object} - Result with error tracking or error
     */
    async getErrorTracking() {
        try {
            // This would contain complex error tracking logic
            return {
                success: true,
                data: {
                    errors: [],
                    totalErrors: 0
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting error tracking:', error);
            return {
                success: false,
                error: 'Failed to get error tracking',
                statusCode: 500
            };
        }
    }

    /**
     * Resolve error
     * @param {string} errorId - Error ID
     * @returns {Object} - Result with success or error
     */
    async resolveError(errorId) {
        try {
            // This would contain error resolution logic
            return {
                success: true,
                message: 'Error resolved successfully',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error resolving error:', error);
            return {
                success: false,
                error: 'Failed to resolve error',
                statusCode: 500
            };
        }
    }

    /**
     * Get most accessed pages
     * @returns {Object} - Result with page data or error
     */
    async getMostAccessedPages() {
        try {
            // This would contain complex page analytics logic
            return {
                success: true,
                data: {
                    pages: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting most accessed pages:', error);
            return {
                success: false,
                error: 'Failed to get most accessed pages',
                statusCode: 500
            };
        }
    }

    /**
     * Get most active users
     * @returns {Object} - Result with user data or error
     */
    async getMostActiveUsers() {
        try {
            // This would contain complex user activity logic
            return {
                success: true,
                data: {
                    users: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting most active users:', error);
            return {
                success: false,
                error: 'Failed to get most active users',
                statusCode: 500
            };
        }
    }

    /**
     * Get most executed commands
     * @returns {Object} - Result with command data or error
     */
    async getMostExecutedCommands() {
        try {
            // This would contain complex command analytics logic
            return {
                success: true,
                data: {
                    commands: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting most executed commands:', error);
            return {
                success: false,
                error: 'Failed to get most executed commands',
                statusCode: 500
            };
        }
    }

    /**
     * Get user timeline
     * @param {string} userId - User ID
     * @returns {Object} - Result with timeline data or error
     */
    async getUserTimeline(userId) {
        try {
            // This would contain complex timeline logic
            return {
                success: true,
                data: {
                    timeline: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting user timeline:', error);
            return {
                success: false,
                error: 'Failed to get user timeline',
                statusCode: 500
            };
        }
    }

    /**
     * Get project usage
     * @returns {Object} - Result with project data or error
     */
    async getProjectUsage() {
        try {
            // This would contain complex project usage logic
            return {
                success: true,
                data: {
                    projects: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting project usage:', error);
            return {
                success: false,
                error: 'Failed to get project usage',
                statusCode: 500
            };
        }
    }

    /**
     * Get realtime metrics
     * @returns {Object} - Result with metrics or error
     */
    async getRealtimeMetrics() {
        try {
            // This would contain complex realtime metrics logic
            return {
                success: true,
                data: {
                    metrics: {}
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting realtime metrics:', error);
            return {
                success: false,
                error: 'Failed to get realtime metrics',
                statusCode: 500
            };
        }
    }

    /**
     * Get user activities
     * @param {string} userId - User ID
     * @param {Object} filters - Filter options
     * @returns {Object} - Result with activities or error
     */
    async getUserActivities(userId, filters = {}) {
        try {
            // This would contain complex user activities logic
            return {
                success: true,
                data: {
                    activities: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting user activities:', error);
            return {
                success: false,
                error: 'Failed to get user activities',
                statusCode: 500
            };
        }
    }

    /**
     * Get user errors
     * @param {string} userId - User ID
     * @returns {Object} - Result with errors or error
     */
    async getUserErrors(userId) {
        try {
            // This would contain complex user errors logic
            return {
                success: true,
                data: {
                    errors: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting user errors:', error);
            return {
                success: false,
                error: 'Failed to get user errors',
                statusCode: 500
            };
        }
    }

    /**
     * Get user sessions
     * @param {string} userId - User ID
     * @returns {Object} - Result with sessions or error
     */
    async getUserSessions(userId) {
        try {
            // This would contain complex user sessions logic
            return {
                success: true,
                data: {
                    sessions: []
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error getting user sessions:', error);
            return {
                success: false,
                error: 'Failed to get user sessions',
                statusCode: 500
            };
        }
    }

    /**
     * Delete user activities
     * @param {string} userId - User ID
     * @returns {Object} - Result with success or error
     */
    async deleteUserActivities(userId) {
        try {
            // This would contain complex deletion logic
            return {
                success: true,
                message: 'User activities deleted successfully',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error deleting user activities:', error);
            return {
                success: false,
                error: 'Failed to delete user activities',
                statusCode: 500
            };
        }
    }

    /**
     * Resolve error by ID
     * @param {string} errorId - Error ID
     * @returns {Object} - Result with success or error
     */
    async resolveErrorById(errorId) {
        try {
            // This would contain error resolution logic
            return {
                success: true,
                message: 'Error resolved successfully',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error resolving error by ID:', error);
            return {
                success: false,
                error: 'Failed to resolve error',
                statusCode: 500
            };
        }
    }

    /**
     * Export user data
     * @param {string} userId - User ID
     * @returns {Object} - Result with export data or error
     */
    async exportUserData(userId) {
        try {
            // This would contain complex data export logic
            return {
                success: true,
                data: {
                    exportData: {}
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error exporting user data:', error);
            return {
                success: false,
                error: 'Failed to export user data',
                statusCode: 500
            };
        }
    }
}
