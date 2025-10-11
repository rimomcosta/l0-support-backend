// src/services/dao/tokenQuotaDao.js
import { pool } from '../../config/database.js';
import { logger } from '../logger.js';

export class TokenQuotaDao {
  /**
   * Get user's daily token usage for a specific date
   * @param {string} userId 
   * @param {string} date - Format: YYYY-MM-DD
   * @returns {Object|null} Usage object or null if not found
   */
  static async getUserDailyUsage(userId, date) {
    try {
      const [rows] = await pool.execute(
        `SELECT id, user_id, usage_date, total_input_tokens, total_output_tokens, 
                total_tokens, daily_limit, last_updated
         FROM user_token_usage 
         WHERE user_id = ? AND usage_date = ?`,
        [userId, date]
      );

      if (rows.length > 0) {
        return {
          id: rows[0].id,
          userId: rows[0].user_id,
          usageDate: rows[0].usage_date,
          totalInputTokens: rows[0].total_input_tokens,
          totalOutputTokens: rows[0].total_output_tokens,
          totalTokens: rows[0].total_tokens,
          dailyLimit: rows[0].daily_limit,
          lastUpdated: rows[0].last_updated
        };
      }

      return null;
    } catch (error) {
      logger.error('Error getting user daily token usage:', {
        error: error.message,
        userId,
        date
      });
      throw error;
    }
  }

  /**
   * Get current day's token usage for a user
   * Creates a new record with DB default limit if none exists
   * @param {string} userId 
   * @returns {Object} Usage object
   */
  static async getCurrentDayUsage(userId) {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const usage = await this.getUserDailyUsage(userId, today);

      if (usage) {
        return usage;
      }

      // No record exists for today - create one with DB DEFAULT values
      // The INSERT will use the DEFAULT daily_limit from the table schema
      await pool.execute(
        `INSERT INTO user_token_usage (user_id, usage_date, total_input_tokens, total_output_tokens, total_tokens)
         VALUES (?, ?, 0, 0, 0)`,
        [userId, today]
      );

      // Now retrieve the newly created record with DB defaults
      const newUsage = await this.getUserDailyUsage(userId, today);
      if (!newUsage) {
        throw new Error('Failed to create token usage record');
      }

      logger.debug('Created new token usage record with DB defaults:', {
        userId,
        usageDate: today,
        dailyLimit: newUsage.dailyLimit
      });

      return newUsage;
    } catch (error) {
      logger.error('Error getting current day token usage:', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Increment token usage for a user on a specific date
   * @param {string} userId 
   * @param {number} inputTokens 
   * @param {number} outputTokens 
   * @param {string} date - Format: YYYY-MM-DD (optional, defaults to today)
   * @returns {boolean} Success status
   */
  static async incrementTokenUsage(userId, inputTokens, outputTokens, date = null) {
    try {
      const usageDate = date || new Date().toISOString().split('T')[0];
      const totalTokens = inputTokens + outputTokens;

      await pool.execute(
        `INSERT INTO user_token_usage 
         (user_id, usage_date, total_input_tokens, total_output_tokens, total_tokens) 
         VALUES (?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
         total_input_tokens = total_input_tokens + VALUES(total_input_tokens), 
         total_output_tokens = total_output_tokens + VALUES(total_output_tokens), 
         total_tokens = total_tokens + VALUES(total_tokens),
         last_updated = CURRENT_TIMESTAMP`,
        [userId, usageDate, inputTokens, outputTokens, totalTokens]
      );

      logger.info('Token usage incremented successfully:', {
        userId,
        usageDate,
        inputTokens,
        outputTokens,
        totalTokens
      });

      return true;
    } catch (error) {
      logger.error('Error incrementing token usage:', {
        error: error.message,
        userId,
        inputTokens,
        outputTokens,
        date
      });
      return false;
    }
  }

  /**
   * Check if user has quota available for estimated tokens
   * @param {string} userId 
   * @param {number} estimatedTokens 
   * @returns {Object} { allowed: boolean, remaining: number, limit: number, used: number }
   * @throws {Error} If unable to check quota (database error, etc.)
   */
  static async checkQuotaAvailable(userId, estimatedTokens) {
    try {
      const usage = await this.getCurrentDayUsage(userId);
      const remaining = usage.dailyLimit - usage.totalTokens;
      const allowed = remaining >= estimatedTokens;

      return {
        allowed,
        remaining,
        limit: usage.dailyLimit,
        used: usage.totalTokens,
        percentUsed: Math.round((usage.totalTokens / usage.dailyLimit) * 100)
      };
    } catch (error) {
      logger.error('Error checking quota availability:', {
        error: error.message,
        userId,
        estimatedTokens
      });
      // Throw error instead of returning fallback - let calling code decide how to handle
      throw error;
    }
  }

  /**
   * Get daily limit for a user
   * Creates a record with DB default if none exists
   * @param {string} userId 
   * @returns {number} Daily limit from database
   * @throws {Error} If unable to get limit (database error, etc.)
   */
  static async getDailyLimit(userId) {
    try {
      const usage = await this.getCurrentDayUsage(userId);
      return usage.dailyLimit;
    } catch (error) {
      logger.error('Error getting daily limit:', {
        error: error.message,
        userId
      });
      // Throw error instead of returning hardcoded fallback
      throw error;
    }
  }

  /**
   * Update daily limit for a user (admin function)
   * @param {string} userId 
   * @param {number} newLimit 
   * @returns {boolean} Success status
   */
  static async updateDailyLimit(userId, newLimit) {
    try {
      const today = new Date().toISOString().split('T')[0];

      await pool.execute(
        `INSERT INTO user_token_usage (user_id, usage_date, daily_limit) 
         VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
         daily_limit = VALUES(daily_limit)`,
        [userId, today, newLimit]
      );

      logger.info('Daily limit updated successfully:', {
        userId,
        newLimit
      });

      return true;
    } catch (error) {
      logger.error('Error updating daily limit:', {
        error: error.message,
        userId,
        newLimit
      });
      return false;
    }
  }

  /**
   * Get usage history for a user
   * @param {string} userId 
   * @param {number} days - Number of days to retrieve (default: 7)
   * @returns {Array} Array of usage records
   */
  static async getUsageHistory(userId, days = 7) {
    try {
      const [rows] = await pool.execute(
        `SELECT usage_date, total_input_tokens, total_output_tokens, 
                total_tokens, daily_limit, last_updated
         FROM user_token_usage 
         WHERE user_id = ? 
         ORDER BY usage_date DESC 
         LIMIT ?`,
        [userId, days]
      );

      return rows.map(row => ({
        usageDate: row.usage_date,
        totalInputTokens: row.total_input_tokens,
        totalOutputTokens: row.total_output_tokens,
        totalTokens: row.total_tokens,
        dailyLimit: row.daily_limit,
        percentUsed: Math.round((row.total_tokens / row.daily_limit) * 100),
        lastUpdated: row.last_updated
      }));
    } catch (error) {
      logger.error('Error getting usage history:', {
        error: error.message,
        userId,
        days
      });
      return [];
    }
  }

  /**
   * Clean up old usage records (older than retention period)
   * @param {number} retentionDays - Days to keep (default: 90)
   * @returns {number} Number of deleted records
   */
  static async cleanupOldRecords(retentionDays = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

      const [result] = await pool.execute(
        'DELETE FROM user_token_usage WHERE usage_date < ?',
        [cutoffDateStr]
      );

      logger.info('Old token usage records cleaned up:', {
        deletedRecords: result.affectedRows,
        cutoffDate: cutoffDateStr
      });

      return result.affectedRows;
    } catch (error) {
      logger.error('Error cleaning up old records:', {
        error: error.message,
        retentionDays
      });
      return 0;
    }
  }
}

