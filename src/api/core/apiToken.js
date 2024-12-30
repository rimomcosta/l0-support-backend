// src/api/core/apiToken.js
import { ApiTokenService } from '../../services/apiTokenService.js';
import { logger } from '../../services/logger.js';

export async function saveApiToken(req, res) {
    try {
        const { apiToken } = req.body;
        const userId = req.session.user.id;

        if (!apiToken) {
            return res.status(400).json({ error: 'API token is required' });
        }

        await ApiTokenService.saveApiToken(userId, apiToken);
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