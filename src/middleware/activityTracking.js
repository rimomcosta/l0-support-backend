// src/middleware/activityTracking.js
import { AnalyticsService } from '../services/analyticsService.js';
import { logger } from '../services/logger.js';

/**
 * Comprehensive activity tracking middleware
 * Tracks meaningful user actions, not every API call
 */
export function trackUserActivity(req, res, next) {
  // Add start time for response time tracking
  req.startTime = Date.now();

  // Store original methods
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;

  // Only track meaningful API calls (not every endpoint)
  res.send = function(data) {
    trackMeaningfulApiCall(req, res, data, 'send');
    originalSend.call(this, data);
  };

  res.json = function(data) {
    trackMeaningfulApiCall(req, res, data, 'json');
    originalJson.call(this, data);
  };

  res.end = function(data) {
    trackMeaningfulApiCall(req, res, data, 'end');
    originalEnd.call(this, data);
  };

  next();
}

/**
 * Track only meaningful API calls (not every endpoint)
 */
async function trackMeaningfulApiCall(req, res, data, method) {
  try {
    if (!req.session?.user) return;

    const responseTime = Date.now() - req.startTime;
    const isError = res.statusCode >= 400;

    // Only track meaningful endpoints, not every API call
    const meaningfulEndpoints = [
      '/api/v1/commands/execute',
      '/api/v1/commands/create',
      '/api/v1/commands/update',
      '/api/v1/commands/delete',
      '/api/v1/chat/send',
      '/api/v1/transaction-analysis',
      '/api/v1/tunnel/create',
      '/api/v1/tunnel/delete',
      '/api/v1/ai-settings/update',
      '/api/v1/dashboard-layout/save',
      '/api/v1/feedback/submit'
    ];

    const isMeaningfulEndpoint = meaningfulEndpoints.some(endpoint => 
      req.path.includes(endpoint)
    );

    // Only track if it's a meaningful endpoint or an error
    if (!isMeaningfulEndpoint && !isError) {
      return;
    }

    const activity = {
      activity_type: isError ? 'error' : 'api_call',
      api_endpoint: req.path,
      request_method: req.method,
      status_code: res.statusCode,
      response_time_ms: responseTime,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      project_id: req.body?.projectId || req.params?.projectId || req.query?.projectId,
      environment: req.body?.environment || req.params?.environment || req.query?.environment,
      request_body: sanitizeRequestBody(req.body),
      response_body: typeof data === 'string' ? data : JSON.stringify(sanitizeResponseBody(data, method)),
      error_message: isError ? (typeof data === 'string' ? data : data?.error || data?.message) : null,
      error_stack: isError ? new Error().stack : null
    };

    await AnalyticsService.trackUserActivity(activity, {
      id: req.session.user.id,
      sessionId: req.sessionID,
      groups: req.session.user.groups
    });

    // If it's an error, also track it separately
    if (isError) {
      await AnalyticsService.trackError({
        error_type: 'api_error',
        error_message: activity.error_message,
        error_stack: activity.error_stack,
        project_id: activity.project_id,
        environment: activity.environment,
        api_endpoint: activity.api_endpoint,
        request_method: activity.request_method,
        request_body: activity.request_body,
        response_body: activity.response_body,
        user_agent: activity.user_agent,
        ip_address: activity.ip_address
      }, {
        id: req.session.user.id,
        sessionId: req.sessionID,
        groups: req.session.user.groups
      });
    }
  } catch (error) {
    logger.error('Failed to track API call:', error);
  }
}

/**
 * Track page views
 */
export function trackPageView(page) {
  return async (req, res, next) => {
    try {
      if (req.session?.user) {
        await AnalyticsService.trackUserActivity({
          activity_type: 'page_view',
          page_url: page,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        }, {
          id: req.session.user.id,
          sessionId: req.sessionID,
          groups: req.session.user.groups
        });
      }
    } catch (error) {
      logger.error('Failed to track page view:', error);
    }
    next();
  };
}

/**
 * Track command execution
 */
export function trackCommandExecution(commandId, commandType, projectId, environment) {
  return async (req, res, next) => {
    try {
      if (req.session?.user) {
        await AnalyticsService.trackUserActivity({
          activity_type: 'command_execution',
          command_id: commandId,
          command_type: commandType,
          project_id: projectId,
          environment: environment,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        }, {
          id: req.session.user.id,
          sessionId: req.sessionID,
          groups: req.session.user.groups
        });
      }
    } catch (error) {
      logger.error('Failed to track command execution:', error);
    }
    next();
  };
}

/**
 * Track WebSocket events
 */
export function trackWebSocketEvent(eventType, eventData) {
  return async (userId, sessionId, groups) => {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'websocket_event',
        websocket_events: {
          event_type: eventType,
          event_data: eventData
        }
      }, {
        id: userId,
        sessionId: sessionId,
        groups: groups
      });
    } catch (error) {
      logger.error('Failed to track WebSocket event:', error);
    }
  };
}

/**
 * Track tunnel operations
 */
export function trackTunnelOperation(operation, projectId, environment) {
  return async (userId, sessionId, groups) => {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'tunnel_operation',
        tunnel_operations: {
          operation: operation,
          project_id: projectId,
          environment: environment
        }
      }, {
        id: userId,
        sessionId: sessionId,
        groups: groups
      });
    } catch (error) {
      logger.error('Failed to track tunnel operation:', error);
    }
  };
}

/**
 * Track chat interactions
 */
export function trackChatInteraction(interactionType, chatId, messageLength) {
  return async (userId, sessionId, groups) => {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'chat_interaction',
        chat_interactions: {
          interaction_type: interactionType,
          chat_id: chatId,
          message_length: messageLength
        }
      }, {
        id: userId,
        sessionId: sessionId,
        groups: groups
      });
    } catch (error) {
      logger.error('Failed to track chat interaction:', error);
    }
  };
}

/**
 * Track transaction analysis
 */
export function trackTransactionAnalysis(analysisId, projectId, environment) {
  return async (userId, sessionId, groups) => {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'transaction_analysis',
        transaction_analysis: {
          analysis_id: analysisId,
          project_id: projectId,
          environment: environment
        }
      }, {
        id: userId,
        sessionId: sessionId,
        groups: groups
      });
    } catch (error) {
      logger.error('Failed to track transaction analysis:', error);
    }
  };
}

/**
 * Sanitize request body for logging
 */
function sanitizeRequestBody(body) {
  if (!body) return null;
  
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'apiToken', 'token', 'secret', 'authorization'];
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

/**
 * Sanitize response body for logging
 */
function sanitizeResponseBody(data, method) {
  if (!data) return null;
  
  // For string responses, try to parse as JSON first
  if (typeof data === 'string') {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(data);
      // If successful, sanitize the parsed object
      const sanitized = { ...parsed };
      const sensitiveFields = ['password', 'apiToken', 'token', 'secret', 'authorization'];
      
      sensitiveFields.forEach(field => {
        if (sanitized[field]) {
          sanitized[field] = '[REDACTED]';
        }
      });
      
      return sanitized;
    } catch (e) {
      // If not valid JSON, treat as plain string and limit length
      return data.length > 1000 ? data.substring(0, 1000) + '...' : data;
    }
  }
  
  // For JSON responses, sanitize sensitive data
  if (typeof data === 'object') {
    const sanitized = { ...data };
    const sensitiveFields = ['password', 'apiToken', 'token', 'secret', 'authorization'];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
  
  return data;
} 