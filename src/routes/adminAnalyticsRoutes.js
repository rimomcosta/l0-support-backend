// src/routes/adminAnalyticsRoutes.js
import express from 'express';
import { AnalyticsService, elasticsearchClient, elasticsearchConfig } from '../services/analyticsService.js';
import { logger } from '../services/logger.js';
import { requireAdmin } from '../middleware/auth.js';
import { pool } from '../config/database.js';

const router = express.Router();

console.log('=== ADMIN ANALYTICS ROUTES LOADED ===');

// Test route
router.get('/test', (req, res) => {
  console.log('=== TEST ROUTE HIT ===');
  res.json({ message: 'Test route working' });
});

// Test route with parameter
router.get('/test/:param', (req, res) => {
  console.log('=== TEST PARAM ROUTE HIT ===', { param: req.params.param });
  res.json({ message: 'Test param route working', param: req.params.param });
});

/**
 * Get individual user details
 */
router.get('/getuser/:userId', async (req, res) => {
      try {
      const { userId } = req.params;
      
      let user;
      
      try {
        // Get user from database
        const [users] = await pool.execute(
          'SELECT * FROM users WHERE user_id = ?',
          [userId]
        );
        
        if (users.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        user = users[0];
    } catch (dbError) {
      console.error('=== DATABASE ERROR ===', dbError);
      res.status(500).json({ error: 'Database error: ' + dbError.message });
      return;
    }
    
    // Get basic analytics for the user
    try {
      // Use a simpler query without complex aggregations
      const response = await elasticsearchClient.search({
        index: elasticsearchConfig.index.user_activities,
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

      const activities = response.hits.hits.map(hit => hit._source);
      const total = response.hits.total.value;
      
      // Calculate basic analytics manually
      const activityTypes = {};
      const projects = new Set();
      const errors = activities.filter(a => a.activity_type === 'error');
      
      activities.forEach(activity => {
        if (activity.activity_type) {
          activityTypes[activity.activity_type] = (activityTypes[activity.activity_type] || 0) + 1;
        }
        if (activity.project_id) {
          projects.add(activity.project_id);
        }
      });

      user.analytics = {
        total_activities: total,
        last_activity: activities.length > 0 ? activities[0]['@timestamp'] : null,
        most_used_features: Object.entries(activityTypes)
          .map(([key, count]) => ({ key, doc_count: count }))
          .sort((a, b) => b.doc_count - a.doc_count)
          .slice(0, 5),
        projects_accessed: projects.size,
        errors_count: errors.length,
        activity_timeline: []
      };
    } catch (analyticsError) {
      logger.error(`Failed to get analytics for user ${userId}:`, analyticsError);
      user.analytics = {
        total_activities: 0,
        last_activity: null,
        most_used_features: [],
        projects_accessed: 0,
        errors_count: 0,
        activity_timeline: []
      };
    }
    
    res.json(user);
  } catch (error) {
    logger.error('Failed to get user details:', error);
    res.status(500).json({ error: 'Failed to retrieve user details' });
  }
});

/**
 * Get comprehensive user analytics
 */
router.get('/users/:userId/analytics', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { timeRange = '30d' } = req.query;
    
    const analytics = await AnalyticsService.getUserAnalytics(userId, timeRange);
    const sessions = await AnalyticsService.getUserSessions(userId, timeRange);
    
    res.json({
      user_id: userId,
      time_range: timeRange,
      analytics,
      sessions
    });
  } catch (error) {
    logger.error('Failed to get user analytics:', error);
    res.status(500).json({ error: 'Failed to retrieve user analytics' });
  }
});

/**
 * Update user information
 */
router.put('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email } = req.body;
    
    // Update user in database
    const [result] = await pool.execute(
      'UPDATE users SET username = ?, email = ?, updated_at = NOW() WHERE user_id = ?',
      [username, email, userId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    logger.error('Failed to update user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * Revoke user API token
 */
router.post('/users/:userId/revoke-token', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Clear API token in database
    const [result] = await pool.execute(
      'UPDATE users SET api_token = NULL, updated_at = NOW() WHERE user_id = ?',
      [userId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, message: 'API token revoked successfully' });
  } catch (error) {
    logger.error('Failed to revoke token:', error);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
});

/**
 * Delete user (soft delete - mark as inactive)
 */
router.delete('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Soft delete - add a deleted_at timestamp
    const [result] = await pool.execute(
      'UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE user_id = ?',
      [userId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * Get all users with analytics summary
 */
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await AnalyticsService.getAllUsersWithAnalytics();
    res.json(users);
  } catch (error) {
    logger.error('Failed to get users for admin:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

/**
 * Test elasticsearch connection
 */
router.get('/test', requireAdmin, async (req, res) => {
  try {
    const health = await elasticsearchClient.cluster.health();
    res.json({ 
      status: 'success', 
      elasticsearch: health.body,
      config: {
        node: elasticsearchConfig.node,
        indices: elasticsearchConfig.index
      }
    });
  } catch (error) {
    logger.error('Elasticsearch test failed:', error);
    res.status(500).json({ error: 'Elasticsearch test failed', details: error.message });
  }
});

/**
 * Test elasticsearch search
 */
router.get('/test-search', requireAdmin, async (req, res) => {
  try {
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          range: { '@timestamp': { gte: 'now-30d' } }
        },
        aggs: {
          total_activities: {
            value_count: { field: 'user_id' }
          }
        },
        size: 0
      }
    });
    
    res.json({ 
      status: 'success', 
      response: response,
      responseType: typeof response,
      responseKeys: Object.keys(response),
      hasBody: !!response.body
    });
  } catch (error) {
    logger.error('Elasticsearch search test failed:', error);
    res.status(500).json({ error: 'Elasticsearch search test failed', details: error.message });
  }
});

/**
 * Get system overview analytics
 */
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    const overview = await AnalyticsService.getSystemOverview(timeRange);
    res.json(overview);
  } catch (error) {
    logger.error('Failed to get system overview:', error);
    res.status(500).json({ error: 'Failed to retrieve system overview' });
  }
});

/**
 * Get error tracking data
 */
router.get('/errors', requireAdmin, async (req, res) => {
  try {
    const { user_id, error_type, severity, timeRange = '7d' } = req.query;
    const filters = { user_id, error_type, severity, timeRange };
    
    const errors = await AnalyticsService.getErrorTracking(filters);
    res.json(errors);
  } catch (error) {
    logger.error('Failed to get error tracking:', error);
    res.status(500).json({ error: 'Failed to retrieve error tracking' });
  }
});

/**
 * Mark error as resolved
 */
router.put('/errors/:errorId/resolve', requireAdmin, async (req, res) => {
  try {
    const { errorId } = req.params;
    await AnalyticsService.resolveError(errorId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve error' });
  }
});

/**
 * Get most accessed pages
 */
router.get('/pages/most-accessed', requireAdmin, async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          bool: {
            must: [
              { term: { activity_type: 'page_view' } },
              { range: { '@timestamp': { gte: `now-${timeRange}` } } }
            ]
          }
        },
        aggs: {
          most_accessed_pages: {
            terms: { field: 'page_url', size: 20 }
          }
        }
      }
    });

    res.json(response.body.aggregations.most_accessed_pages);
  } catch (error) {
    logger.error('Failed to get most accessed pages:', error);
    res.status(500).json({ error: 'Failed to retrieve most accessed pages' });
  }
});

/**
 * Get most active users
 */
router.get('/users/most-active', requireAdmin, async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          range: { '@timestamp': { gte: `now-${timeRange}` } }
        },
        aggs: {
          most_active_users: {
            terms: { field: 'user_id', size: 20 }
          }
        }
      }
    });

    res.json(response.body.aggregations.most_active_users);
  } catch (error) {
    logger.error('Failed to get most active users:', error);
    res.status(500).json({ error: 'Failed to retrieve most active users' });
  }
});

/**
 * Get most executed commands
 */
router.get('/commands/most-executed', requireAdmin, async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          bool: {
            must: [
              { term: { activity_type: 'command_execution' } },
              { range: { '@timestamp': { gte: `now-${timeRange}` } } }
            ]
          }
        },
        aggs: {
          most_executed_commands: {
            terms: { field: 'command_type', size: 20 }
          }
        }
      }
    });

    res.json(response.body.aggregations.most_executed_commands);
  } catch (error) {
    logger.error('Failed to get most executed commands:', error);
    res.status(500).json({ error: 'Failed to retrieve most executed commands' });
  }
});

/**
 * Get user activity timeline
 */
router.get('/users/:userId/timeline', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { timeRange = '7d' } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          bool: {
            must: [
              { term: { user_id: userId } },
              { range: { '@timestamp': { gte: `now-${timeRange}` } } }
            ]
          }
        },
        aggs: {
          activity_timeline: {
            date_histogram: {
              field: '@timestamp',
              calendar_interval: '1h'
            },
            aggs: {
              activity_types: {
                terms: { field: 'activity_type' }
              }
            }
          }
        }
      }
    });

    res.json(response.body.aggregations.activity_timeline);
  } catch (error) {
    logger.error('Failed to get user timeline:', error);
    res.status(500).json({ error: 'Failed to retrieve user timeline' });
  }
});

/**
 * Get project usage analytics
 */
router.get('/projects/usage', requireAdmin, async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          bool: {
            must: [
              { exists: { field: 'project_id' } },
              { range: { '@timestamp': { gte: `now-${timeRange}` } } }
            ]
          }
        },
        aggs: {
          project_usage: {
            terms: { field: 'project_id', size: 50 },
            aggs: {
              environments: {
                terms: { field: 'environment' }
              },
              activity_types: {
                terms: { field: 'activity_type' }
              },
              users: {
                cardinality: { field: 'user_id' }
              }
            }
          }
        }
      }
    });

    res.json(response.body.aggregations.project_usage);
  } catch (error) {
    logger.error('Failed to get project usage:', error);
    res.status(500).json({ error: 'Failed to retrieve project usage' });
  }
});

/**
 * Get real-time system metrics
 */
router.get('/metrics/realtime', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          range: { '@timestamp': { gte: oneHourAgo.toISOString() } }
        },
        aggs: {
          active_users_last_hour: {
            cardinality: { field: 'user_id' }
          },
          activities_last_hour: {
            value_count: { field: 'user_id' }
          },
          errors_last_hour: {
            filter: { term: { activity_type: 'error' } },
            aggs: {
              error_count: { value_count: { field: 'user_id' } }
            }
          }
        }
      }
    });

    res.json({
      timestamp: now.toISOString(),
      metrics: response.body.aggregations
    });
  } catch (error) {
    logger.error('Failed to get real-time metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve real-time metrics' });
  }
});

/**
 * Get user activities with filters
 */
router.get('/users/:userId/activities', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { activityType, dateRange = '30d', projectId, environment } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_activities,
      body: {
        query: {
          bool: {
            must: [
              { term: { user_id: userId } },
              { range: { '@timestamp': { gte: `now-${dateRange}` } } }
            ],
            filter: []
          }
        },
        sort: [{ '@timestamp': { order: 'desc' } }],
        size: 1000
      }
    });

    let activities = response.hits.hits.map(hit => ({
      _id: hit._id,
      ...hit._source
    }));

    // Apply additional filters
    if (activityType) {
      activities = activities.filter(activity => activity.activity_type === activityType);
    }
    if (projectId) {
      activities = activities.filter(activity => activity.project_id === projectId);
    }
    if (environment) {
      activities = activities.filter(activity => activity.environment === environment);
    }

    res.json({ activities });
  } catch (error) {
    logger.error('Failed to get user activities:', error);
    res.status(500).json({ error: 'Failed to get user activities' });
  }
});

/**
 * Get user errors
 */
router.get('/users/:userId/errors', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { dateRange = '30d' } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.error_tracking,
      body: {
        query: {
          bool: {
            must: [
              { term: { user_id: userId } },
              { range: { '@timestamp': { gte: `now-${dateRange}` } } }
            ]
          }
        },
        sort: [{ '@timestamp': { order: 'desc' } }],
        size: 1000
      }
    });

    const errors = response.hits.hits.map(hit => ({
      _id: hit._id,
      ...hit._source
    }));

    res.json({ errors });
  } catch (error) {
    logger.error('Failed to get user errors:', error);
    res.status(500).json({ error: 'Failed to get user errors' });
  }
});

/**
 * Get user sessions
 */
router.get('/users/:userId/sessions', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { dateRange = '30d' } = req.query;
    
    const response = await elasticsearchClient.search({
      index: elasticsearchConfig.index.user_sessions,
      body: {
        query: {
          bool: {
            must: [
              { term: { user_id: userId } },
              { range: { '@timestamp': { gte: `now-${dateRange}` } } }
            ]
          }
        },
        sort: [{ '@timestamp': { order: 'desc' } }],
        size: 100
      }
    });

    const sessions = response.hits.hits.map(hit => ({
      _id: hit._id,
      ...hit._source
    }));

    res.json({ sessions });
  } catch (error) {
    logger.error('Failed to get user sessions:', error);
    res.status(500).json({ error: 'Failed to get user sessions' });
  }
});

/**
 * Delete user activities
 */
router.delete('/users/:userId/activities', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { activityIds } = req.body;
    
    if (!activityIds || !Array.isArray(activityIds)) {
      return res.status(400).json({ error: 'Activity IDs array is required' });
    }

    // Delete activities from Elasticsearch
    const deletePromises = activityIds.map(activityId =>
      elasticsearchClient.delete({
        index: elasticsearchConfig.index.user_activities,
        id: activityId
      }).catch(err => {
        logger.error(`Failed to delete activity ${activityId}:`, err);
        return null;
      })
    );

    await Promise.all(deletePromises);
    
    res.json({ success: true, message: `Deleted ${activityIds.length} activities` });
  } catch (error) {
    logger.error('Failed to delete user activities:', error);
    res.status(500).json({ error: 'Failed to delete user activities' });
  }
});

/**
 * Resolve error
 */
router.put('/errors/:errorId/resolve', requireAdmin, async (req, res) => {
  try {
    const { errorId } = req.params;
    
    await elasticsearchClient.update({
      index: elasticsearchConfig.index.error_tracking,
      id: errorId,
      body: {
        doc: {
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: req.session.user.id
        }
      }
    });
    
    res.json({ success: true, message: 'Error marked as resolved' });
  } catch (error) {
    logger.error('Failed to resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve error' });
  }
});

/**
 * Export user data
 */
router.get('/users/:userId/export', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { dateRange = '30d' } = req.query;
    
    // Get all user data
    const [activitiesResponse, errorsResponse, sessionsResponse] = await Promise.all([
      elasticsearchClient.search({
        index: elasticsearchConfig.index.user_activities,
        body: {
          query: {
            bool: {
              must: [
                { term: { user_id: userId } },
                { range: { '@timestamp': { gte: `now-${dateRange}` } } }
              ]
            }
          },
          size: 10000
        }
      }),
      elasticsearchClient.search({
        index: elasticsearchConfig.index.error_tracking,
        body: {
          query: {
            bool: {
              must: [
                { term: { user_id: userId } },
                { range: { '@timestamp': { gte: `now-${dateRange}` } } }
              ]
            }
          },
          size: 10000
        }
      }),
      elasticsearchClient.search({
        index: elasticsearchConfig.index.user_sessions,
        body: {
          query: {
            bool: {
              must: [
                { term: { user_id: userId } },
                { range: { '@timestamp': { gte: `now-${dateRange}` } } }
              ]
            }
          },
          size: 1000
        }
      })
    ]);

    const exportData = {
      userId,
      exportDate: new Date().toISOString(),
      dateRange,
      activities: activitiesResponse.hits.hits.map(hit => hit._source),
      errors: errorsResponse.hits.hits.map(hit => hit._source),
      sessions: sessionsResponse.hits.hits.map(hit => hit._source)
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${userId}-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(exportData);
  } catch (error) {
    logger.error('Failed to export user data:', error);
    res.status(500).json({ error: 'Failed to export user data' });
  }
});

export default router; 