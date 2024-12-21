// src/api/app/tunnel.js
import { tunnelManager } from '../../services/tunnelService.js';
import { logger } from '../../services/logger.js';

export async function openTunnel(req, res) {
    const { projectId, environment } = req.params;

    try {
        const tunnelInfo = await tunnelManager.openTunnel(projectId, environment);
        
        // Respond with the tunnel info
        res.json({
            message: 'Tunnel opened successfully',
            tunnelInfo: tunnelInfo
        });
    } catch (error) {
        logger.error('Failed to open tunnel:', {
            error: error.message,
            projectId,
            environment
        });

        res.status(500).json({
            error: 'Failed to open tunnel',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}