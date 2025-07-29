// src/config/elasticsearch.js
import { Client } from '@elastic/elasticsearch';
import { logger } from '../services/logger.js';

export const elasticsearchConfig = {
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  auth: {
    username: process.env.ELASTICSEARCH_USER || '',
    password: process.env.ELASTICSEARCH_PASSWORD || ''
  },
  index: {
    user_activities: 'l0support-user-activities',
    system_metrics: 'l0support-system-metrics',
    error_tracking: 'l0support-error-tracking',
    user_sessions: 'l0support-user-sessions'
  }
};

// Create Elasticsearch client
export const elasticsearchClient = new Client(elasticsearchConfig);

// Initialize Elasticsearch indices
export async function initializeElasticsearch() {
  try {
    // Create user activities index
    await elasticsearchClient.indices.create({
      index: elasticsearchConfig.index.user_activities,
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
    }, { ignore: [400] }); // Ignore if index already exists

    // Create system metrics index
    await elasticsearchClient.indices.create({
      index: elasticsearchConfig.index.system_metrics,
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
    }, { ignore: [400] });

    // Create error tracking index
    await elasticsearchClient.indices.create({
      index: elasticsearchConfig.index.error_tracking,
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
    }, { ignore: [400] });

    // Create user sessions index
    await elasticsearchClient.indices.create({
      index: elasticsearchConfig.index.user_sessions,
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
    }, { ignore: [400] });

    logger.info('Elasticsearch indices initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Elasticsearch indices:', error);
    throw error;
  }
} 