// src/services/dao/aiSettingsDao.js
import { pool } from '../../config/database.js';
import { logger } from '../logger.js';

export class AiSettingsDao {
  /**
   * Get AI settings for a user, creating defaults if none exist
   * @param {string} userId 
   * @returns {Object} AI settings object
   */
  static async getUserSettings(userId) {
    try {
      const [rows] = await pool.execute(
        'SELECT ai_model, response_style, response_length FROM user_ai_settings WHERE user_id = ?',
        [userId]
      );

      if (rows.length > 0) {
        return {
          aiModel: rows[0].ai_model,
          responseStyle: rows[0].response_style,
          responseLength: rows[0].response_length
        };
      }

      // No settings found, create defaults
      const defaultSettings = {
        aiModel: 'fast',
        responseStyle: 'balanced', 
        responseLength: 'default'
      };

      await this.saveUserSettings(userId, defaultSettings);
      return defaultSettings;
    } catch (error) {
      logger.error('Error getting user AI settings:', {
        error: error.message,
        userId
      });
      
      // Return defaults on error
      return {
        aiModel: 'fast',
        responseStyle: 'balanced',
        responseLength: 'default'
      };
    }
  }

  /**
   * Save AI settings for a user
   * @param {string} userId 
   * @param {Object} settings - {aiModel, responseStyle, responseLength}
   * @returns {boolean} Success status
   */
  static async saveUserSettings(userId, settings) {
    try {
      const { aiModel, responseStyle, responseLength } = settings;

      // Validate enum values
      const validModels = ['reasoning', 'fast'];
      const validStyles = ['objective', 'balanced', 'creative'];
      const validLengths = ['short', 'default', 'long'];

      if (!validModels.includes(aiModel)) {
        throw new Error(`Invalid AI model: ${aiModel}`);
      }
      if (!validStyles.includes(responseStyle)) {
        throw new Error(`Invalid response style: ${responseStyle}`);
      }
      if (!validLengths.includes(responseLength)) {
        throw new Error(`Invalid response length: ${responseLength}`);
      }

      await pool.execute(
        `INSERT INTO user_ai_settings (user_id, ai_model, response_style, response_length) 
         VALUES (?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
         ai_model = VALUES(ai_model), 
         response_style = VALUES(response_style), 
         response_length = VALUES(response_length),
         updated_at = CURRENT_TIMESTAMP`,
        [userId, aiModel, responseStyle, responseLength]
      );

      logger.info('User AI settings saved successfully:', {
        userId,
        settings: { aiModel, responseStyle, responseLength }
      });

      return true;
    } catch (error) {
      logger.error('Error saving user AI settings:', {
        error: error.message,
        userId,
        settings
      });
      return false;
    }
  }

  /**
   * Reset user settings to defaults
   * @param {string} userId 
   * @returns {boolean} Success status
   */
  static async resetUserSettings(userId) {
    try {
      await pool.execute(
        'DELETE FROM user_ai_settings WHERE user_id = ?',
        [userId]
      );

      logger.info('User AI settings reset to defaults:', { userId });
      return true;
    } catch (error) {
      logger.error('Error resetting user AI settings:', {
        error: error.message,
        userId
      });
      return false;
    }
  }

  /**
   * Convert database settings to runtime configuration
   * @param {Object} settings - Database settings object
   * @returns {Object} Runtime configuration
   */
  static settingsToConfig(settings) {
    const { aiModel, responseStyle, responseLength } = settings;

    // Map AI model to provider and model
    let provider, model;
    if (aiModel === 'fast') {
      provider = 'google_vertex';
      model = 'gemini-2.5-flash';
    } else { // reasoning
      provider = 'google_vertex';
      model = 'gemini-2.5-pro';
    }

    // Map response style to temperature
    const temperatureMap = {
      'objective': 0.2,
      'balanced': 0.7,
      'creative': 1.2
    };
    const temperature = temperatureMap[responseStyle];

    // Map response length to maxTokens
    const maxTokensMap = {
      'short': 8000,
      'default': 32000,
      'long': 64000
    };
    const maxTokens = maxTokensMap[responseLength];

    return {
      provider,
      model,
      temperature,
      maxTokens,
      stream: true, // Always enabled
      topP: 0.95
    };
  }
} 