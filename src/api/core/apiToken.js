// src/api/core/apiToken.js
import { ApiTokenService } from '../../services/apiTokenService.js';
import { logger } from '../../services/logger.js';
import { EncryptionService } from '../../services/encryptionService.js';

export async function saveApiToken(req, res) {
    try {
        const { apiToken, password } = req.body; // Get both apiToken and password
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
        const salt = user.salt;

        // Encrypt the API token using the provided password and the retrieved salt
        const encryptedApiToken = EncryptionService.encrypt(apiToken, password, salt);

        await ApiTokenService.saveApiToken(userId, encryptedApiToken, salt);
        res.json({ success: true, message: 'API token saved successfully' });
    } catch (error) {
        logger.error('Failed to save API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ error: 'Failed to save API token' });
    }
}

export async function getApiToken(req, res) {
    try {
        const userId = req.session.user.id;
        const apiToken = await ApiTokenService.getApiToken(userId);
        const hasToken = Boolean(apiToken);

        res.json({ hasToken });
    } catch (error) {
        logger.error('Failed to check API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ error: 'Failed to check API token' });
    }
}

export async function decryptAndVerifyApiToken(req, res) {
    try {
        const { password } = req.body;
        const userId = req.session.user.id;

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        const user = await ApiTokenService.getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const encryptedApiToken = user.api_token;
        if (!encryptedApiToken) {
            return res.status(404).json({ error: 'API token not found' });
        }

        const salt = user.salt;

        // Decrypt the API token using the provided password and the retrieved salt
        const decryptedApiToken = EncryptionService.decrypt(encryptedApiToken, password, salt);

        // TODO: Verify the decrypted token (e.g., make a test call to Magento Cloud API)
        // This is a placeholder for the verification logic
        const isTokenValid = true; // Replace with actual verification logic

        if (!isTokenValid) {
            throw new Error('API token verification failed');
        }

        res.json({ success: true, message: 'API token decrypted and verified successfully' });
    } catch (error) {
        logger.error('Failed to decrypt/verify API token:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(401).json({ error: 'Invalid API token or password' });
    }
}