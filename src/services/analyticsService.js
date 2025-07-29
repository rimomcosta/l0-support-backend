// src/services/analyticsService.js
import { elasticsearchClient, elasticsearchConfig } from '../config/elasticsearch.js';
import { logger } from './logger.js';
import { pool } from '../config/database.js';

// Export for use in routes
export { elasticsearchClient, elasticsearchConfig };

export class AnalyticsService {
  /**
   * Track comprehensive user activity
   */
  static async trackUserActivity(activity, userSession) {
    try {
      const activityData = {
        '@timestamp': new Date().toISOString(),
        user_id: userSession?.id || 'unknown',
        session_id: userSession?.sessionId || 'unknown',
        activity_type: activity.activity_type,
        activity_details: activity.activity_details || {},
        project_id: activity.project_id,
        environment: activity.environment,
        ip_address: activity.ip_address,
        user_agent: activity.user_agent,
        response_time_ms: activity.response_time_ms,
        status_code: activity.status_code,
        error_message: activity.error_message,
        error_stack: activity.error_stack,
        okta_groups: userSession?.groups || [],
        command_id: activity.command_id,
        command_type: activity.command_type,
        command_output: activity.command_output,
        page_url: activity.page_url,
        api_endpoint: activity.api_endpoint,
        request_method: activity.request_method,
        request_body: activity.request_body,
        response_body: activity.response_body,
        websocket_events: activity.websocket_events,
        tunnel_operations: activity.tunnel_operations,
        chat_interactions: activity.chat_interactions,
        transaction_analysis: activity.transaction_analysis
      };

      // Store in Elasticsearch
      await elasticsearchClient.index({
        index: elasticsearchConfig.index.user_activities,
        body: activityData
      });

      logger.debug('User activity tracked', {
        user_id: activityData.user_id,
        activity_type: activityData.activity_type,
        timestamp: activityData['@timestamp']
      });

      return activityData;
    } catch (error) {
      logger.error('Failed to track user activity:', error);
      // Don't throw error to avoid breaking user experience
    }
  }

  /**
   * Track user session lifecycle
   */
  static async trackUserSession(sessionData) {
    try {
      const sessionRecord = {
        '@timestamp': new Date().toISOString(),
        user_id: sessionData.user_id,
        session_id: sessionData.session_id,
        login_time: sessionData.login_time,
        logout_time: sessionData.logout_time,
        session_duration_ms: sessionData.session_duration_ms,
        okta_groups: sessionData.okta_groups || [],
        ip_address: sessionData.ip_address,
        user_agent: sessionData.user_agent,
        activities_count: sessionData.activities_count || 0,
        errors_count: sessionData.errors_count || 0,
        projects_accessed: sessionData.projects_accessed || [],
        environments_accessed: sessionData.environments_accessed || []
      };

      await elasticsearchClient.index({
        index: elasticsearchConfig.index.user_sessions,
        body: sessionRecord
      });

      logger.debug('User session tracked', {
        user_id: sessionRecord.user_id,
        session_id: sessionRecord.session_id
      });
    } catch (error) {
      logger.error('Failed to track user session:', error);
    }
  }

  /**
   * Track errors with full context
   */
  static async trackError(errorData, userSession) {
    try {
      const errorRecord = {
        '@timestamp': new Date().toISOString(),
        user_id: userSession?.id || 'unknown',
        session_id: userSession?.sessionId || 'unknown',
        error_type: errorData.error_type,
        error_message: errorData.error_message,
        error_stack: errorData.error_stack,
        error_context: {
          project_id: errorData.project_id,
          environment: errorData.environment,
          command_id: errorData.command_id,
          api_endpoint: errorData.api_endpoint,
          request_method: errorData.request_method,
          request_body: errorData.request_body,
          response_body: errorData.response_body,
          user_agent: errorData.user_agent,
          ip_address: errorData.ip_address
        },
        severity: errorData.severity || 'error',
        resolved: false
      };

      await elasticsearchClient.index({
        index: elasticsearchConfig.index.error_tracking,
        body: errorRecord
      });

      logger.error('Error tracked in analytics', {
        user_id: errorRecord.user_id,
        error_type: errorRecord.error_type,
        error_message: errorRecord.error_message
      });
    } catch (error) {
      logger.error('Failed to track error:', error);
    }
  }

  /**
   * Get comprehensive user analytics
   */
  static async getUserAnalytics(userId, timeRange = '30d') {
    try {
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
          sort: [{ '@timestamp': { order: 'desc' } }],
          size: 10000,
          aggs: {
            activity_types: {
              terms: { field: 'activity_type', size: 50 }
            },
            projects_accessed: {
              terms: { field: 'project_id', size: 50 }
            },
            environments_accessed: {
              terms: { field: 'environment', size: 20 }
            },
            commands_executed: {
              terms: { field: 'command_type', size: 50 }
            },
            errors_by_type: {
              terms: { field: 'error_message.keyword', size: 20 }
            },
            activity_timeline: {
              date_histogram: {
                field: '@timestamp',
                calendar_interval: '1d'
              }
            }
          }
        }
      });

      return {
        activities: response.hits.hits.map(hit => hit._source),
        aggregations: response.aggregations,
        total: response.hits.total.value
      };
    } catch (error) {
      logger.error('Failed to get user analytics:', error);
      throw error;
    }
  }

  /**
   * Get system overview analytics
   */
  static async getSystemOverview(timeRange = '7d') {
    try {
      logger.debug('Getting system overview for timeRange:', timeRange);
      
      // Use the exact same query that works in curl
      const response = await elasticsearchClient.search({
        index: elasticsearchConfig.index.user_activities,
        body: {
          query: {
            range: { '@timestamp': { gte: `now-${timeRange}` } }
          },
          aggs: {
            active_users: {
              cardinality: { field: 'user_id' }
            },
            total_activities: {
              value_count: { field: 'user_id' }
            },
            activity_by_type: {
              terms: { field: 'activity_type', size: 20 }
            },
            most_active_users: {
              terms: { field: 'user_id', size: 10 }
            },
            most_accessed_pages: {
              terms: { field: 'page_url', size: 10 }
            },
            most_executed_commands: {
              terms: { field: 'command_type', size: 10 }
            },
            error_summary: {
              filter: { term: { activity_type: 'error' } },
              aggs: {
                error_count: { value_count: { field: 'user_id' } },
                error_types: { terms: { field: 'error_message.keyword', size: 10 } }
              }
            },
            admin_activity: {
              filter: { term: { 'okta_groups': 'GRP-L0SUPPORT-ADMIN' } },
              aggs: {
                admin_activities: { value_count: { field: 'user_id' } }
              }
            }
          },
          size: 0
        }
      });

      logger.debug('System overview response:', response);
      return response.aggregations;
    } catch (error) {
      logger.error('Failed to get system overview:', error);
      // Return fallback data if Elasticsearch fails
      return {
        active_users: { value: 0 },
        total_activities: { value: 0 },
        activity_by_type: { buckets: [] },
        most_active_users: { buckets: [] },
        most_accessed_pages: { buckets: [] },
        most_executed_commands: { buckets: [] },
        error_summary: {
          doc_count: 0,
          error_count: { value: 0 },
          error_types: { buckets: [] }
        },
        admin_activity: {
          doc_count: 0,
          admin_activities: { value: 0 }
        }
      };
    }
  }

  /**
   * Get all users with analytics summary
   */
  static async getAllUsersWithAnalytics() {
    try {
      // Get users from MySQL
      const [users] = await pool.execute('SELECT * FROM users ORDER BY created_at DESC');
      
      // Get analytics for each user
      const usersWithAnalytics = await Promise.all(
        users.map(async (user) => {
          try {
            const analytics = await this.getUserAnalytics(user.user_id, '30d');
            const lastActivity = analytics.activities && analytics.activities.length > 0 
              ? analytics.activities[0] 
              : null;
            
            return {
              ...user,
              analytics: {
                total_activities: analytics.total,
                last_activity: lastActivity?.['@timestamp'],
                most_used_features: analytics.aggregations?.activity_types?.buckets?.slice(0, 5) || [],
                projects_accessed: analytics.aggregations?.projects_accessed?.buckets?.length || 0,
                errors_count: analytics.aggregations?.errors_by_type?.buckets?.length || 0,
                activity_timeline: analytics.aggregations?.activity_timeline?.buckets || []
              }
            };
          } catch (error) {
            logger.error(`Failed to get analytics for user ${user.user_id}:`, error);
            return {
              ...user,
              analytics: {
                total_activities: 0,
                last_activity: null,
                most_used_features: [],
                projects_accessed: 0,
                errors_count: 0,
                activity_timeline: []
              }
            };
          }
        })
      );

      return usersWithAnalytics;
    } catch (error) {
      logger.error('Failed to get users with analytics:', error);
      throw error;
    }
  }

  /**
   * Get user session history
   */
  static async getUserSessions(userId, timeRange = '30d') {
    try {
      const response = await elasticsearchClient.search({
        index: elasticsearchConfig.index.user_sessions,
        body: {
          query: {
            bool: {
              must: [
                { term: { user_id: userId } },
                { range: { '@timestamp': { gte: `now-${timeRange}` } } }
              ]
            }
          },
          sort: [{ '@timestamp': { order: 'desc' } }],
          size: 100
        }
      });

      return response.hits.hits.map(hit => hit._source);
    } catch (error) {
      logger.error('Failed to get user sessions:', error);
      throw error;
    }
  }

  /**
   * Get error tracking data
   */
  static async getErrorTracking(filters = {}) {
    try {
      const query = {
        bool: {
          must: []
        }
      };

      if (filters.user_id) {
        query.bool.must.push({ term: { user_id: filters.user_id } });
      }

      if (filters.error_type) {
        query.bool.must.push({ term: { error_type: filters.error_type } });
      }

      if (filters.severity) {
        query.bool.must.push({ term: { severity: filters.severity } });
      }

      if (filters.timeRange) {
        query.bool.must.push({ range: { '@timestamp': { gte: `now-${filters.timeRange}` } } });
      }

      const response = await elasticsearchClient.search({
        index: elasticsearchConfig.index.error_tracking,
        body: {
          query,
          sort: [{ '@timestamp': { order: 'desc' } }],
          size: 1000
        }
      });

      return response.hits.hits.map(hit => hit._source);
    } catch (error) {
      logger.error('Failed to get error tracking:', error);
      throw error;
    }
  }

  /**
   * Mark error as resolved
   */
  static async resolveError(errorId) {
    try {
      await elasticsearchClient.update({
        index: elasticsearchConfig.index.error_tracking,
        id: errorId,
        body: {
          doc: {
            resolved: true,
            resolved_at: new Date().toISOString()
          }
        }
      });

      logger.info('Error marked as resolved', { error_id: errorId });
    } catch (error) {
      logger.error('Failed to resolve error:', error);
      throw error;
    }
  }
} 