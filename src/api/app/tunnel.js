// src/api/app/tunnel.js
import { TunnelManagementService } from '../../services/tunnelManagementService.js';
import { logger } from '../../services/logger.js';

export async function openTunnel(req, res) {
    try {
        const { projectId, environment } = req.params;
        const apiToken = req.session.decryptedApiToken;
        const userId = req.session.user.id; // Extract userId from session
        
        const tunnelService = new TunnelManagementService();
        const result = await tunnelService.openTunnel(projectId, environment, apiToken, userId);
        
        res.status(result.statusCode).json(result.success ? {
            message: 'Tunnel opened successfully',
            tunnelInfo: result.tunnelInfo
        } : {
            error: result.error,
            details: result.details
        });
    } catch (error) {
        logger.error('Failed to open tunnel:', {
            error: error.message,
            projectId: req.params.projectId,
            environment: req.params.environment,
            userId: req.session?.user?.id
        });

        res.status(500).json({
            error: 'Failed to open tunnel',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
