// src/services/tokenQuotaService.js
import { TokenQuotaDao } from './dao/tokenQuotaDao.js';
import { tokenCountingService } from './tokenCountingService.js';
import { logger } from './logger.js';
import { WebSocketService } from './webSocketService.js';

export class TokenQuotaService {
  /**
   * Check if user has quota available for estimated tokens
   * @param {string} userId 
   * @param {number} estimatedTokens 
   * @returns {Promise<Object>} { allowed, remaining, limit, used, percentUsed, resetTime }
   */
  static async checkQuota(userId, estimatedTokens) {
    try {
      const quotaCheck = await TokenQuotaDao.checkQuotaAvailable(userId, estimatedTokens);
      
      // Calculate reset time (midnight UTC of next day)
      const resetTime = this.getNextResetTime();

      logger.debug('Quota check result:', {
        userId,
        estimatedTokens,
        ...quotaCheck,
        resetTime
      });

      return {
        ...quotaCheck,
        resetTime
      };
    } catch (error) {
      logger.error('Error checking quota:', {
        error: error.message,
        userId,
        estimatedTokens
      });
      throw error;
    }
  }

  /**
   * Track token usage after AI generation
   * @param {string} userId 
   * @param {number} inputTokens 
   * @param {number} outputTokens 
   * @returns {Promise<boolean>} Success status
   */
  static async trackUsage(userId, inputTokens, outputTokens) {
    try {
      const success = await TokenQuotaDao.incrementTokenUsage(userId, inputTokens, outputTokens);
      
      if (success) {
        logger.info('Token usage tracked:', {
          userId,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens
        });
      }

      return success;
    } catch (error) {
      logger.error('Error tracking token usage:', {
        error: error.message,
        userId,
        inputTokens,
        outputTokens
      });
      return false;
    }
  }

  /**
   * Get user's current usage statistics
   * @param {string} userId 
   * @returns {Promise<Object>} Usage statistics
   */
  static async getUserUsageStats(userId) {
    try {
      const usage = await TokenQuotaDao.getCurrentDayUsage(userId);
      const resetTime = this.getNextResetTime();

      return {
        used: usage.totalTokens,
        limit: usage.dailyLimit,
        remaining: usage.dailyLimit - usage.totalTokens,
        percentUsed: Math.round((usage.totalTokens / usage.dailyLimit) * 100),
        inputTokens: usage.totalInputTokens,
        outputTokens: usage.totalOutputTokens,
        resetTime,
        lastUpdated: usage.lastUpdated
      };
    } catch (error) {
      logger.error('Error getting user usage stats:', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Get user's usage history
   * @param {string} userId 
   * @param {number} days - Number of days (default: 7)
   * @returns {Promise<Array>} Usage history
   */
  static async getUserUsageHistory(userId, days = 7) {
    try {
      return await TokenQuotaDao.getUsageHistory(userId, days);
    } catch (error) {
      logger.error('Error getting user usage history:', {
        error: error.message,
        userId,
        days
      });
      return [];
    }
  }

  /**
   * Count tokens for input content
   * @param {string|Array} content - Text or messages array
   * @param {string} model - Model name
   * @returns {Promise<number>} Token count
   */
  static async countInputTokens(content, model = 'gemini-2.5-pro') {
    try {
      return await tokenCountingService.countTokens(content, model);
    } catch (error) {
      logger.error('Error counting input tokens:', {
        error: error.message,
        model
      });
      // Return estimation as fallback
      return tokenCountingService.estimateTokens(content);
    }
  }

  /**
   * Count tokens for output content
   * @param {string} content - Response text
   * @param {string} model - Model name
   * @returns {Promise<number>} Token count
   */
  static async countOutputTokens(content, model = 'gemini-2.5-pro') {
    try {
      return await tokenCountingService.countTokens(content, model);
    } catch (error) {
      logger.error('Error counting output tokens:', {
        error: error.message,
        model
      });
      // Return estimation as fallback
      return tokenCountingService.estimateTokens(content);
    }
  }

  /**
   * Get next reset time (midnight UTC)
   * @returns {string} ISO string of next reset time
   */
  static getNextResetTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }

  /**
   * Update user's daily limit (admin function)
   * @param {string} userId 
   * @param {number} newLimit 
   * @returns {Promise<boolean>} Success status
   */
  static async updateUserLimit(userId, newLimit) {
    try {
      if (newLimit < 0) {
        throw new Error('Daily limit cannot be negative');
      }

      const success = await TokenQuotaDao.updateDailyLimit(userId, newLimit);
      
      if (success) {
        logger.info('User daily limit updated:', {
          userId,
          newLimit
        });
      }

      return success;
    } catch (error) {
      logger.error('Error updating user limit:', {
        error: error.message,
        userId,
        newLimit
      });
      return false;
    }
  }

  /**
   * Check and enforce quota before AI generation
   * This is the main method to use before any AI call
   * @param {string} userId 
   * @param {string|Array} inputContent 
   * @param {string} model 
   * @returns {Promise<Object>} { allowed, quotaInfo, estimatedInputTokens }
   */
  static async checkAndEnforceQuota(userId, inputContent, model = 'gemini-2.5-pro') {
    try {
      // Count input tokens
      const estimatedInputTokens = await this.countInputTokens(inputContent, model);
      
      // Check quota
      const quotaInfo = await this.checkQuota(userId, estimatedInputTokens);

      if (!quotaInfo.allowed) {
        logger.warn('Quota exceeded for user:', {
          userId,
          estimatedInputTokens,
          used: quotaInfo.used,
          limit: quotaInfo.limit
        });
      }

      return {
        allowed: quotaInfo.allowed,
        quotaInfo,
        estimatedInputTokens
      };
    } catch (error) {
      logger.error('Error in checkAndEnforceQuota:', {
        error: error.message,
        userId,
        model
      });
      throw error;
    }
  }

  /**
   * Track usage after AI generation completes
   * @param {string} userId 
   * @param {number} inputTokens 
   * @param {string} outputContent 
   * @param {string} model 
   * @returns {Promise<Object>} { success, inputTokens, outputTokens, totalTokens }
   */
  static async trackAfterGeneration(userId, inputTokens, outputContent, model = 'gemini-2.5-pro') {
    try {
      // Count output tokens
      const outputTokens = await this.countOutputTokens(outputContent, model);
      
      // Track the usage
      const success = await this.trackUsage(userId, inputTokens, outputTokens);

      // Broadcast updated usage stats to user via WebSocket
      if (success) {
        try {
          const updatedStats = await this.getUserUsageStats(userId);
          WebSocketService.sendToUser(userId, {
            type: 'token_usage_update',
            usage: updatedStats
          });
        } catch (wsError) {
          logger.error('Failed to broadcast token usage update:', {
            error: wsError.message,
            userId
          });
          // Don't fail the main operation if broadcast fails
        }
      }

      return {
        success,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      };
    } catch (error) {
      logger.error('Error in trackAfterGeneration:', {
        error: error.message,
        userId,
        inputTokens,
        model
      });
      return {
        success: false,
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens
      };
    }
  }

  /**
   * Create quota exceeded error response
   * @param {Object} quotaInfo 
   * @returns {Object} Error response object
   */
  static createQuotaExceededError(quotaInfo) {
    return {
      type: 'quota_exceeded',
      error: 'Daily token quota exceeded',
      message: `Your daily token quota of ${quotaInfo.limit.toLocaleString()} tokens has been reached. The quota will reset at ${new Date(quotaInfo.resetTime).toLocaleTimeString()} UTC.`,
      details: {
        used: quotaInfo.used,
        limit: quotaInfo.limit,
        remaining: quotaInfo.remaining,
        percentUsed: quotaInfo.percentUsed,
        resetTime: quotaInfo.resetTime
      }
    };
  }
}

