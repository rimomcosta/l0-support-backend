// src/api/core/apiToken.js
import { ApiTokenService } from '../../services/apiTokenService.js';
import { logger } from '../../services/logger.js';
import { EncryptionService } from '../../services/encryptionService.js';

/**
 * Encrypts and saves the API token, then stores the decrypted token in the session.
 */
export async function encryptAndSaveApiToken(req, res) {
    try {
        const { apiToken, password } = req.body;
        const userId = req.session.user.id;

        if (!apiToken) {
            return res.status(400).json({ error: 'API token is required' });
        }

        if (!password) {
            return res.status(400).json({ error: 'Password is required for encrypting the API token' });
        }

        // Get the user's salt from the database
        const user = await ApiTokenService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        let salt = user.salt;
        
        // If user doesn't have a salt (e.g., first time setting API token), generate one
        if (!salt) {
            salt = EncryptionService.generateSalt();
            // Update the user with the new salt
            await ApiTokenService.updateUserSalt(userId, salt);
            logger.info('Generated new salt for user', { userId });
        }

        // Encrypt the API token using the provided password and salt
        const encryptedApiToken = EncryptionService.encrypt(apiToken, password, salt);

        // Save the encrypted API token
        await ApiTokenService.saveApiToken(userId, encryptedApiToken);

        // Decrypt the API token immediately to store in session
        const decryptedApiToken = EncryptionService.decrypt(encryptedApiToken, password, salt);

        // Store the decrypted API token and flags in the session
        req.session.decryptedApiToken = decryptedApiToken;
        req.session.hasApiToken = true;
        req.session.isApiTokenDecrypted = true;

        await req.session.save(); // Ensure session is saved

        res.json({ success: true, message: 'API token saved and decrypted successfully' });
    } catch (error) {
        logger.error('Failed to save API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ error: 'Failed to save API token' });
    }
}

/**
 * Decrypts the API token using the provided password and stores it in the session.
 */
export async function decryptApiToken(req, res) {
    try {
        const { password } = req.body;
        const userId = req.session.user.id;

        if (!password) {
            return res.status(400).json({ error: 'Password is required for decrypting the API token' });
        }

        // Retrieve the encrypted API token
        const encryptedApiToken = await ApiTokenService.getApiToken(userId);
        if (!encryptedApiToken) {
            return res.status(404).json({ error: 'API token not found for user' });
        }

        // Get the user's salt from the database
        const user = await ApiTokenService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const salt = user.salt;

        // Decrypt the API token using the provided password and salt
        let decryptedApiToken;
        try {
            decryptedApiToken = EncryptionService.decrypt(encryptedApiToken, password, salt);
        } catch (decryptError) {
            logger.warn('Failed to decrypt API token:', {
                error: decryptError.message,
                userId
            });
            return res.status(401).json({ error: 'Failed to decrypt API token' });
        }

        // Store the decrypted API token and update flags in the session
        req.session.decryptedApiToken = decryptedApiToken;
        req.session.isApiTokenDecrypted = true;
        req.session.hasApiToken = true;

        await req.session.save(); // Ensure session is saved

        res.json({ success: true, message: 'API token decrypted successfully' });
    } catch (error) {
        logger.error('Failed to decrypt API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ error: 'Failed to decrypt API token' });
    }
}

/**
 * Checks if the API token exists and if it's decrypted.
 * This function does NOT perform decryption.
 */
export async function getApiToken(req, res) {
    try {
        const userId = req.session.user.id;
        const hasToken = Boolean(await ApiTokenService.getApiToken(userId));
        const isDecrypted = req.session.isApiTokenDecrypted || false;

        res.json({ hasToken, isDecrypted });
    } catch (error) {
        logger.error('Failed to check API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ error: 'Failed to check API token' });
    }
}

/**
 * Revokes (deletes) the user's API token.
 */
export async function revokeApiToken(req, res) {
    try {
        const userId = req.session.user.id;

        // Delete the API token from the database
        await ApiTokenService.deleteApiToken(userId);

        // Clear the decrypted API token from session
        delete req.session.decryptedApiToken;
        delete req.session.hasApiToken;
        delete req.session.isApiTokenDecrypted;

        await req.session.save(); // Ensure session is saved

        logger.info('API token revoked successfully:', {
            userId
        });

        res.json({ success: true, message: 'API token revoked successfully' });
    } catch (error) {
        logger.error('Failed to revoke API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ error: 'Failed to revoke API token' });
    }
}
