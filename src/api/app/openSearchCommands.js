// src/api/app/openSearchCommands.js
import { OpenSearchManagementService } from '../../services/openSearchManagementService.js';

/**
 * Executes a set of queries against the search service (OpenSearch or Elasticsearch).
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 */
export async function runQueries(req, res) {
    const { projectId, environment } = req.params;
    const { queries } = req.body;
    const apiToken = req.session.decryptedApiToken;
    const userId = req.session.user.id;

    if (!Array.isArray(queries)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Queries must be an array'
        });
    }

    try {
        // Delegate to service
        const openSearchService = new OpenSearchManagementService();
        const result = await openSearchService.runQueries(projectId, environment, queries, apiToken, userId);

        res.status(result.statusCode).json(result.success ? {
            projectId: result.projectId,
            environment: result.environment,
            timestamp: result.timestamp,
            results: result.results
        } : {
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
