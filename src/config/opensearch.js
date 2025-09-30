// src/config/opensearch.js
import { Client } from '@opensearch-project/opensearch';
import { logger } from '../services/logger.js';

export const opensearchConfig = {
  node: process.env.OPENSEARCH_URL || 'http://localhost:9201',
  auth: process.env.OPENSEARCH_USER && process.env.OPENSEARCH_PASSWORD ? {
    username: process.env.OPENSEARCH_USER,
    password: process.env.OPENSEARCH_PASSWORD
  } : undefined,
  ssl: {
    rejectUnauthorized: false
  },
  index: {
    user_activities: 'l0support-user-activities',
    system_metrics: 'l0support-system-metrics',
    error_tracking: 'l0support-error-tracking',
    user_sessions: 'l0support-user-sessions'
  }
};

// Create OpenSearch client
export const opensearchClient = new Client({
  node: opensearchConfig.node,
  ...(opensearchConfig.auth && { auth: opensearchConfig.auth }),
  ssl: opensearchConfig.ssl
});

// Initialize OpenSearch indices
export async function initializeOpenSearch() {
  try {
    logger.info('Initializing OpenSearch indices...');
    
    // Create user activities index
    await opensearchClient.indices.create({
      index: opensearchConfig.index.user_activities,
      body: {
        mappings: {
          properties: {
            '@timestamp': { type: 'date' },
            user_id: { type: 'keyword' },
            session_id: { type: 'keyword' },
            activity_type: { type: 'keyword' },
            activity_details: { type: 'object', dynamic: true },
            project_id: { type: 'keyword' },
            environment: { type: 'keyword' },
            ip_address: { type: 'ip' },
            user_agent: { type: 'text' },
            response_time_ms: { type: 'long' },
            status_code: { type: 'integer' },
            error_message: { 
              type: 'text',
              fields: {
                keyword: { type: 'keyword' }
              }
            },
            error_stack: { type: 'text' },
            okta_groups: { type: 'keyword' },
            command_id: { type: 'keyword' },
            command_type: { type: 'keyword' },
            command_output: { type: 'text' },
            page_url: { type: 'keyword' },
            api_endpoint: { type: 'keyword' },
            request_method: { type: 'keyword' },
            request_body: { type: 'object', dynamic: true },
            response_body: { type: 'text' },
            websocket_events: { type: 'object', dynamic: true },
            tunnel_operations: { type: 'object', dynamic: true },
            chat_interactions: { type: 'object', dynamic: true },
            transaction_analysis: { type: 'object', dynamic: true }
          }
        },
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0
        }
      }
    }).catch(err => {
      if (err.meta?.body?.error?.type === 'resource_already_exists_exception') {
        logger.info('User activities index already exists');
      } else {
        throw err;
      }
    });

    // Create system metrics index
    await opensearchClient.indices.create({
      index: opensearchConfig.index.system_metrics,
      body: {
        mappings: {
          properties: {
            '@timestamp': { type: 'date' },
            metric_type: { type: 'keyword' },
            metric_value: { type: 'float' },
            metric_details: { type: 'object', dynamic: true }
          }
        }
      }
    }).catch(err => {
      if (err.meta?.body?.error?.type === 'resource_already_exists_exception') {
        logger.info('System metrics index already exists');
      } else {
        throw err;
      }
    });

    // Create error tracking index
    await opensearchClient.indices.create({
      index: opensearchConfig.index.error_tracking,
      body: {
        mappings: {
          properties: {
            '@timestamp': { type: 'date' },
            user_id: { type: 'keyword' },
            session_id: { type: 'keyword' },
            error_type: { type: 'keyword' },
            error_message: { 
              type: 'text',
              fields: {
                keyword: { type: 'keyword' }
              }
            },
            error_stack: { type: 'text' },
            error_context: { type: 'object', dynamic: true },
            severity: { type: 'keyword' },
            resolved: { type: 'boolean' }
          }
        }
      }
    }).catch(err => {
      if (err.meta?.body?.error?.type === 'resource_already_exists_exception') {
        logger.info('Error tracking index already exists');
      } else {
        throw err;
      }
    });

    // Create user sessions index
    await opensearchClient.indices.create({
      index: opensearchConfig.index.user_sessions,
      body: {
        mappings: {
          properties: {
            '@timestamp': { type: 'date' },
            user_id: { type: 'keyword' },
            session_id: { type: 'keyword' },
            login_time: { type: 'date' },
            logout_time: { type: 'date' },
            session_duration_ms: { type: 'long' },
            okta_groups: { type: 'keyword' },
            ip_address: { type: 'ip' },
            user_agent: { type: 'text' },
            activities_count: { type: 'integer' },
            errors_count: { type: 'integer' },
            projects_accessed: { type: 'keyword' },
            environments_accessed: { type: 'keyword' }
          }
        }
      }
    }).catch(err => {
      if (err.meta?.body?.error?.type === 'resource_already_exists_exception') {
        logger.info('User sessions index already exists');
      } else {
        throw err;
      }
    });

    logger.info('OpenSearch indices initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize OpenSearch indices:', error);
    throw error;
  }
}
