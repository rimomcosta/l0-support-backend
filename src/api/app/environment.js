// src/api/app/environment.js
import { EnvironmentManagementService } from '../../services/environmentManagementService.js';

export async function getEnvironments(req, res) {
    const { projectId } = req.params;
    const userId = req.session.user.id;

    const apiToken = req.session.decryptedApiToken;
    if (!apiToken) {
        return res.status(401).json({ error: 'API token not found for user' });
    }

    try {
        // Delegate to service
        const environmentService = new EnvironmentManagementService();
        const result = await environmentService.getEnvironments(projectId, apiToken, userId);

        res.status(result.statusCode).json(result.success ? result.environments : {
            error: result.error,
            message: result.message,
            code: result.code,
            details: result.details
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}