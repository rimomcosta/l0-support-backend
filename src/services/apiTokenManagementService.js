// src/services/apiTokenManagementService.js
import { ApiTokenService } from './apiTokenService.js';
import { logger } from './logger.js';
import { logActivity } from './activityLogger.js';
import { EncryptionService } from './encryptionService.js';

export class ApiTokenManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate API token and password
     * @param {string} apiToken - API token
     * @param {string} password - Password
     * @returns {Object} - Validation result
     */
    validateApiTokenInput(apiToken, password) {
        if (!apiToken) {
            return {
                valid: false,
                error: 'API token is required',
                statusCode: 400
            };
        }

        if (!password) {
            return {
                valid: false,
                error: 'Password is required for encrypting the API token',
                statusCode: 400
            };
        }

        return { valid: true };
    }

    /**
     * Validate password for decryption
     * @param {string} password - Password
     * @returns {Object} - Validation result
     */
    validatePassword(password) {
        if (!password) {
            return {
                valid: false,
                error: 'Password is required for decrypting the API token',
                statusCode: 400
            };
        }

        return { valid: true };
    }

    /**
     * Encrypt and save API token
     * @param {string} apiToken - API token
     * @param {string} password - Password
     * @param {string} userId - User ID
     * @param {string} userEmail - User email
     * @returns {Object} - Operation result
     */
    async encryptAndSaveApiToken(apiToken, password, userId, userEmail) {
        try {
            // Validate input
            const validation = this.validateApiTokenInput(apiToken, password);
            if (!validation.valid) {
                return validation;
            }

            // Get the user's salt from the database
            const user = await ApiTokenService.getUserById(userId);
            if (!user) {
                return {
                    success: false,
                    error: 'User not found',
                    statusCode: 404
                };
            }
            
            let salt = user.salt;
            
            // If user doesn't have a salt (e.g., first time setting API token), generate one
            if (!salt) {
                salt = EncryptionService.generateSalt();
                // Update the user with the new salt
                await ApiTokenService.updateUserSalt(userId, salt);
                this.logger.info('Generated new salt for user', { userId });
            }

            // Encrypt the API token using the provided password and salt
            const encryptedApiToken = EncryptionService.encrypt(apiToken, password, salt);

            // Save the encrypted API token
            await ApiTokenService.saveApiToken(userId, encryptedApiToken);

            // Decrypt the API token immediately to store in session
            const decryptedApiToken = EncryptionService.decrypt(encryptedApiToken, password, salt);

            // Log activity
            logActivity.apiToken.saved(userId, userEmail);

            return {
                success: true,
                message: 'API token saved and decrypted successfully',
                decryptedApiToken,
                statusCode: 200
            };

        } catch (error) {
            this.logger.error('Failed to save API token:', {
                error: error.message,
                userId
            });
            return {
                success: false,
                error: 'Failed to save API token',
                statusCode: 500
            };
        }
    }

    /**
     * Decrypt API token
     * @param {string} password - Password
     * @param {string} userId - User ID
     * @param {string} userEmail - User email
     * @returns {Object} - Operation result
     */
    async decryptApiToken(password, userId, userEmail) {
        try {
            // Validate input
            const validation = this.validatePassword(password);
            if (!validation.valid) {
                return validation;
            }

            // Retrieve the encrypted API token
            const encryptedApiToken = await ApiTokenService.getApiToken(userId);
            if (!encryptedApiToken) {
                return {
                    success: false,
                    error: 'API token not found for user',
                    statusCode: 404
                };
            }

            // Get the user's salt from the database
            const user = await ApiTokenService.getUserById(userId);
            if (!user) {
                return {
                    success: false,
                    error: 'User not found',
                    statusCode: 404
                };
            }
            const salt = user.salt;

            // Decrypt the API token using the provided password and salt
            let decryptedApiToken;
            try {
                decryptedApiToken = EncryptionService.decrypt(encryptedApiToken, password, salt);
            } catch (decryptError) {
                this.logger.warn('Failed to decrypt API token:', {
                    error: decryptError.message,
                    userId
                });
                return {
                    success: false,
                    error: 'Failed to decrypt API token',
                    statusCode: 401
                };
            }

            // Log activity
            logActivity.apiToken.decrypted(userId, userEmail);

            return {
                success: true,
                message: 'API token decrypted successfully',
                decryptedApiToken,
                statusCode: 200
            };

        } catch (error) {
            this.logger.error('Failed to decrypt API token:', {
                error: error.message,
                userId
            });
            return {
                success: false,
                error: 'Failed to decrypt API token',
                statusCode: 500
            };
        }
    }

    /**
     * Check API token status
     * @param {string} userId - User ID
     * @param {boolean} isDecrypted - Whether token is decrypted in session
     * @returns {Object} - Status result
     */
    async getApiTokenStatus(userId, isDecrypted) {
        try {
            const hasToken = Boolean(await ApiTokenService.getApiToken(userId));
            const isDecryptedStatus = isDecrypted || false;

            return {
                success: true,
                hasToken,
                isDecrypted: isDecryptedStatus,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to check API token:', {
                error: error.message,
                userId
            });
            return {
                success: false,
                error: 'Failed to check API token',
                statusCode: 500
            };
        }
    }

    /**
     * Revoke API token
     * @param {string} userId - User ID
     * @param {string} userEmail - User email
     * @returns {Object} - Operation result
     */
    async revokeApiToken(userId, userEmail) {
        try {
            // Delete the API token from the database
            await ApiTokenService.deleteApiToken(userId);

            this.logger.info('API token revoked successfully:', {
                userId
            });

            // Log activity
            logActivity.apiToken.revoked(userId, userEmail);

            return {
                success: true,
                message: 'API token revoked successfully',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to revoke API token:', {
                error: error.message,
                userId
            });
            return {
                success: false,
                error: 'Failed to revoke API token',
                statusCode: 500
            };
        }
    }
}
