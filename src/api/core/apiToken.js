// src/api/core/apiToken.js
import { ApiTokenManagementService } from '../../services/apiTokenManagementService.js';
import { logger } from '../../services/logger.js';

/**
 * Encrypts and saves the API token, then stores the decrypted token in the session.
 */
export async function encryptAndSaveApiToken(req, res) {
    try {
        const { apiToken, password } = req.body;
        const userId = req.session.user.id;
        const userEmail = req.session.user.email;

        // Delegate to service
        const managementService = new ApiTokenManagementService();
        const result = await managementService.encryptAndSaveApiToken(apiToken, password, userId, userEmail);

        if (result.success) {
            // Store the decrypted API token and flags in the session
            req.session.decryptedApiToken = result.decryptedApiToken;
            req.session.hasApiToken = true;
            req.session.isApiTokenDecrypted = true;
            await req.session.save(); // Ensure session is saved
        }

        res.status(result.statusCode).json({
            success: result.success,
            message: result.message || result.error
        });
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
        const userEmail = req.session.user.email;

        // Delegate to service
        const managementService = new ApiTokenManagementService();
        const result = await managementService.decryptApiToken(password, userId, userEmail);

        if (result.success) {
            // Store the decrypted API token and update flags in the session
            req.session.decryptedApiToken = result.decryptedApiToken;
            req.session.isApiTokenDecrypted = true;
            req.session.hasApiToken = true;
            await req.session.save(); // Ensure session is saved
        }

        res.status(result.statusCode).json({
            success: result.success,
            message: result.message || result.error
        });
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
        const isDecrypted = req.session.isApiTokenDecrypted || false;

        // Delegate to service
        const managementService = new ApiTokenManagementService();
        const result = await managementService.getApiTokenStatus(userId, isDecrypted);

        res.status(result.statusCode).json({
            hasToken: result.hasToken,
            isDecrypted: result.isDecrypted
        });
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
        const userEmail = req.session.user.email;

        // Delegate to service
        const managementService = new ApiTokenManagementService();
        const result = await managementService.revokeApiToken(userId, userEmail);

        if (result.success) {
            // Clear the decrypted API token from session
            delete req.session.decryptedApiToken;
            delete req.session.hasApiToken;
            delete req.session.isApiTokenDecrypted;
            await req.session.save(); // Ensure session is saved
        }

        res.status(result.statusCode).json({
            success: result.success,
            message: result.message || result.error
        });
    } catch (error) {
        logger.error('Failed to revoke API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ error: 'Failed to revoke API token' });
    }
}