// src/api/app/tunnel.js
import { tunnelManager } from '../../services/tunnelService.js';
import { logger } from '../../services/logger.js';

export async function openTunnel(req, res) {
    const { projectId, environment } = req.params;
    const apiToken = req.session.decryptedApiToken;
    const userId = req.session.user.id; // Extract userId from session
    // Avoid logging sensitive tokens
    try {
        const tunnelInfo = await tunnelManager.openTunnel(projectId, environment, apiToken, userId);

        // Respond with the tunnel info
        res.json({
            message: 'Tunnel opened successfully',
            tunnelInfo: tunnelInfo
        });
    } catch (error) {
        logger.error('Failed to open tunnel:', {
            error: error.message,
            projectId,
            environment,
            userId
        });

        res.status(500).json({
            error: 'Failed to open tunnel',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
