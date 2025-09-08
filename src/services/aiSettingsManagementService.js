// src/services/aiSettingsManagementService.js
import { AiSettingsDao } from './dao/aiSettingsDao.js';
import { logger } from './logger.js';

export class AiSettingsManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate AI settings input
     * @param {Object} settings - Settings to validate
     * @returns {Object} - Validation result
     */
    validateAiSettings(settings) {
        const { aiModel, responseStyle, responseLength } = settings;

        if (!aiModel || !responseStyle || !responseLength) {
            return {
                valid: false,
                error: 'Missing required settings: aiModel, responseStyle, responseLength'
            };
        }

        // Additional validation can be added here
        if (!['gpt-3.5-turbo', 'gpt-4', 'claude-3'].includes(aiModel)) {
            return {
                valid: false,
                error: 'Invalid AI model selected'
            };
        }

        if (!['concise', 'detailed', 'balanced'].includes(responseStyle)) {
            return {
                valid: false,
                error: 'Invalid response style selected'
            };
        }

        if (!['short', 'medium', 'long'].includes(responseLength)) {
            return {
                valid: false,
                error: 'Invalid response length selected'
            };
        }

        return { valid: true };
    }

    /**
     * Get user AI settings
     * @param {string} userId - User ID
     * @returns {Object} - Result with settings or error
     */
    async getAiSettings(userId) {
        try {
            const settings = await AiSettingsDao.getUserSettings(userId);
            
            return {
                success: true,
                data: {
                    success: true,
                    settings
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error fetching user AI settings:', {
                error: error.message,
                userId
            });
            return {
                success: false,
                error: 'Failed to fetch AI settings',
                statusCode: 500
            };
        }
    }

    /**
     * Save user AI settings
     * @param {string} userId - User ID
     * @param {Object} settings - Settings to save
     * @returns {Object} - Result with success or error
     */
    async saveAiSettings(userId, settings) {
        try {
            const validation = this.validateAiSettings(settings);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error,
                    statusCode: 400
                };
            }

            const { aiModel, responseStyle, responseLength } = settings;
            const settingsData = { aiModel, responseStyle, responseLength };
            
            const success = await AiSettingsDao.saveUserSettings(userId, settingsData);
            
            if (success) {
                this.logger.info('User AI settings updated:', {
                    userId,
                    settings: settingsData
                });
                
                return {
                    success: true,
                    data: {
                        success: true,
                        message: 'AI settings saved successfully',
                        settings: settingsData
                    },
                    statusCode: 200
                };
            } else {
                return {
                    success: false,
                    error: 'Failed to save AI settings',
                    statusCode: 500
                };
            }
        } catch (error) {
            this.logger.error('Error saving user AI settings:', {
                error: error.message,
                userId,
                settings
            });
            return {
                success: false,
                error: 'Failed to save AI settings',
                statusCode: 500
            };
        }
    }

    /**
     * Reset user AI settings to defaults
     * @param {string} userId - User ID
     * @returns {Object} - Result with success or error
     */
    async resetAiSettings(userId) {
        try {
            const success = await AiSettingsDao.resetUserSettings(userId);
            
            if (success) {
                // Get the default settings
                const settings = await AiSettingsDao.getUserSettings(userId);
                
                this.logger.info('User AI settings reset:', { userId });
                
                return {
                    success: true,
                    data: {
                        success: true,
                        message: 'AI settings reset to defaults',
                        settings
                    },
                    statusCode: 200
                };
            } else {
                return {
                    success: false,
                    error: 'Failed to reset AI settings',
                    statusCode: 500
                };
            }
        } catch (error) {
            this.logger.error('Error resetting user AI settings:', {
                error: error.message,
                userId
            });
            return {
                success: false,
                error: 'Failed to reset AI settings',
                statusCode: 500
            };
        }
    }
}
