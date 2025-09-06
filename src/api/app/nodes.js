// src/api/app/nodes.js
import { NodesManagementService } from '../../services/nodesManagementService.js';

// Export the execute function for backward compatibility with other modules
export async function execute(projectId, environment, apiToken, userId) {
    const nodesService = new NodesManagementService();
    return await nodesService.execute(projectId, environment, apiToken, userId);
}

/**
 * API handler for getting nodes information.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getNodes(req, res) {
    const { projectId, environment } = req.params;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken;

    if (!apiToken) {
        return res.status(401).json({ error: 'API token not found for user' });
    }

    try {
        // Delegate to service
        const nodesService = new NodesManagementService();
        const result = await nodesService.getNodes(projectId, environment, apiToken, userId);

        res.status(result.statusCode).json(result.success ? { nodes: result.nodes } : {
            error: result.error,
            details: result.details
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}