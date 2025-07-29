// src/services/userActivityService.js
import { AnalyticsService } from './analyticsService.js';
import { logger } from './logger.js';

export class UserActivityService {
  /**
   * Track user page navigation
   */
  static async trackPageView(userSession, pageName, pageUrl, projectId = null, environment = null) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'page_view',
        activity_details: {
          page_name: pageName,
          page_url: pageUrl,
          project_id: projectId,
          environment: environment
        },
        project_id: projectId,
        environment: environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Page view tracked', { 
        user_id: userSession.id, 
        page_name: pageName,
        project_id: projectId 
      });
    } catch (error) {
      logger.error('Failed to track page view:', error);
    }
  }

  /**
   * Track command execution
   */
  static async trackCommandExecution(userSession, commandData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'command_execution',
        activity_details: {
          command_name: commandData.command_name,
          command_type: commandData.command_type,
          project_id: commandData.project_id,
          environment: commandData.environment,
          command_output_length: commandData.output?.length || 0,
          execution_time_ms: commandData.execution_time || 0
        },
        command_id: commandData.command_id,
        command_type: commandData.command_type,
        command_output: commandData.output,
        project_id: commandData.project_id,
        environment: commandData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Command execution tracked', { 
        user_id: userSession.id, 
        command_name: commandData.command_name,
        project_id: commandData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track command execution:', error);
    }
  }

  /**
   * Track command creation
   */
  static async trackCommandCreation(userSession, commandData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'command_creation',
        activity_details: {
          command_name: commandData.command_name,
          command_type: commandData.command_type,
          project_id: commandData.project_id,
          environment: commandData.environment
        },
        command_id: commandData.command_id,
        command_type: commandData.command_type,
        project_id: commandData.project_id,
        environment: commandData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Command creation tracked', { 
        user_id: userSession.id, 
        command_name: commandData.command_name,
        project_id: commandData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track command creation:', error);
    }
  }

  /**
   * Track project data fetch
   */
  static async trackProjectDataFetch(userSession, projectId, environment, dataType) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'project_data_fetch',
        activity_details: {
          data_type: dataType,
          project_id: projectId,
          environment: environment
        },
        project_id: projectId,
        environment: environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Project data fetch tracked', { 
        user_id: userSession.id, 
        data_type: dataType,
        project_id: projectId 
      });
    } catch (error) {
      logger.error('Failed to track project data fetch:', error);
    }
  }

  /**
   * Track environment change
   */
  static async trackEnvironmentChange(userSession, oldEnvironment, newEnvironment, projectId = null) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'environment_change',
        activity_details: {
          old_environment: oldEnvironment,
          new_environment: newEnvironment,
          project_id: projectId
        },
        project_id: projectId,
        environment: newEnvironment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Environment change tracked', { 
        user_id: userSession.id, 
        old_environment: oldEnvironment,
        new_environment: newEnvironment,
        project_id: projectId 
      });
    } catch (error) {
      logger.error('Failed to track environment change:', error);
    }
  }

  /**
   * Track project selection
   */
  static async trackProjectSelection(userSession, projectId, environment = null) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'project_selection',
        activity_details: {
          project_id: projectId,
          environment: environment
        },
        project_id: projectId,
        environment: environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Project selection tracked', { 
        user_id: userSession.id, 
        project_id: projectId,
        environment: environment 
      });
    } catch (error) {
      logger.error('Failed to track project selection:', error);
    }
  }

  /**
   * Track chat interaction
   */
  static async trackChatInteraction(userSession, chatData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'chat_interaction',
        activity_details: {
          message_type: chatData.message_type, // 'user_message' or 'ai_response'
          message_length: chatData.message?.length || 0,
          project_id: chatData.project_id,
          environment: chatData.environment,
          ai_model: chatData.ai_model
        },
        chat_interactions: {
          message_type: chatData.message_type,
          ai_model: chatData.ai_model,
          project_id: chatData.project_id,
          environment: chatData.environment
        },
        project_id: chatData.project_id,
        environment: chatData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Chat interaction tracked', { 
        user_id: userSession.id, 
        message_type: chatData.message_type,
        project_id: chatData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track chat interaction:', error);
    }
  }

  /**
   * Track transaction analysis
   */
  static async trackTransactionAnalysis(userSession, analysisData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'transaction_analysis',
        activity_details: {
          transaction_id: analysisData.transaction_id,
          project_id: analysisData.project_id,
          environment: analysisData.environment,
          analysis_type: analysisData.analysis_type
        },
        transaction_analysis: {
          transaction_id: analysisData.transaction_id,
          analysis_type: analysisData.analysis_type,
          project_id: analysisData.project_id,
          environment: analysisData.environment
        },
        project_id: analysisData.project_id,
        environment: analysisData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Transaction analysis tracked', { 
        user_id: userSession.id, 
        transaction_id: analysisData.transaction_id,
        project_id: analysisData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track transaction analysis:', error);
    }
  }

  /**
   * Track tunnel operations
   */
  static async trackTunnelOperation(userSession, tunnelData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'tunnel_operation',
        activity_details: {
          operation_type: tunnelData.operation_type, // 'create', 'delete', 'list'
          project_id: tunnelData.project_id,
          environment: tunnelData.environment,
          tunnel_id: tunnelData.tunnel_id,
          status: tunnelData.status
        },
        tunnel_operations: {
          operation_type: tunnelData.operation_type,
          tunnel_id: tunnelData.tunnel_id,
          project_id: tunnelData.project_id,
          environment: tunnelData.environment
        },
        project_id: tunnelData.project_id,
        environment: tunnelData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Tunnel operation tracked', { 
        user_id: userSession.id, 
        operation_type: tunnelData.operation_type,
        project_id: tunnelData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track tunnel operation:', error);
    }
  }

  /**
   * Track settings changes
   */
  static async trackSettingsChange(userSession, settingsData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'settings_change',
        activity_details: {
          setting_type: settingsData.setting_type, // 'ai_settings', 'dashboard_layout', 'preferences'
          setting_name: settingsData.setting_name,
          old_value: settingsData.old_value,
          new_value: settingsData.new_value,
          project_id: settingsData.project_id,
          environment: settingsData.environment
        },
        project_id: settingsData.project_id,
        environment: settingsData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Settings change tracked', { 
        user_id: userSession.id, 
        setting_type: settingsData.setting_type,
        setting_name: settingsData.setting_name,
        project_id: settingsData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track settings change:', error);
    }
  }

  /**
   * Track data export
   */
  static async trackDataExport(userSession, exportData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'data_export',
        activity_details: {
          export_type: exportData.export_type, // 'analytics', 'reports', 'logs'
          export_format: exportData.export_format, // 'json', 'csv', 'pdf'
          data_range: exportData.data_range,
          project_id: exportData.project_id,
          environment: exportData.environment,
          record_count: exportData.record_count
        },
        project_id: exportData.project_id,
        environment: exportData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Data export tracked', { 
        user_id: userSession.id, 
        export_type: exportData.export_type,
        project_id: exportData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track data export:', error);
    }
  }

  /**
   * Track search operations
   */
  static async trackSearchOperation(userSession, searchData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'search_operation',
        activity_details: {
          search_type: searchData.search_type, // 'opensearch', 'redis', 'sql', 'bash'
          search_query: searchData.search_query,
          project_id: searchData.project_id,
          environment: searchData.environment,
          result_count: searchData.result_count,
          execution_time_ms: searchData.execution_time_ms
        },
        project_id: searchData.project_id,
        environment: searchData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Search operation tracked', { 
        user_id: userSession.id, 
        search_type: searchData.search_type,
        project_id: searchData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track search operation:', error);
    }
  }

  /**
   * Track authentication events
   */
  static async trackAuthEvent(userSession, authData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'auth_event',
        activity_details: {
          event_type: authData.event_type, // 'login', 'logout', 'token_refresh', 'session_expired'
          auth_method: authData.auth_method, // 'okta', 'api_token', 'session'
          success: authData.success,
          error_message: authData.error_message,
          ip_address: authData.ip_address
        },
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      logger.debug('Auth event tracked', { 
        user_id: userSession.id, 
        event_type: authData.event_type,
        success: authData.success 
      });
    } catch (error) {
      logger.error('Failed to track auth event:', error);
    }
  }

  /**
   * Track error occurrence
   */
  static async trackError(userSession, errorData) {
    try {
      await AnalyticsService.trackUserActivity({
        activity_type: 'error',
        activity_details: {
          error_type: errorData.error_type,
          error_message: errorData.error_message,
          error_context: errorData.error_context,
          project_id: errorData.project_id,
          environment: errorData.environment
        },
        error_message: errorData.error_message,
        error_stack: errorData.error_stack,
        project_id: errorData.project_id,
        environment: errorData.environment,
        ip_address: userSession.ip_address,
        user_agent: userSession.user_agent
      }, userSession);

      // Also track in error tracking index
      await AnalyticsService.trackError({
        error_type: errorData.error_type,
        error_message: errorData.error_message,
        error_stack: errorData.error_stack,
        error_context: errorData.error_context,
        severity: errorData.severity || 'medium',
        project_id: errorData.project_id,
        environment: errorData.environment
      }, userSession);

      logger.debug('Error tracked', { 
        user_id: userSession.id, 
        error_type: errorData.error_type,
        project_id: errorData.project_id 
      });
    } catch (error) {
      logger.error('Failed to track error:', error);
    }
  }
} 