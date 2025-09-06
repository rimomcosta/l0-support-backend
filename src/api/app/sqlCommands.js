'use strict';

import { logger } from '../../services/logger.js';
import { CommandValidationService } from '../../services/commandValidationService.js';
import { ServiceExecutionService } from '../../services/serviceExecutionService.js';

// Business logic moved to ServiceExecutionService

// Main API handler for executing SQL queries
async function runQueries(req, res) {
    const { projectId, environment } = req.params;
    const { queries } = req.body;
    const userId = req.session.user.id;

    // Validate queries using service
    const validationService = new CommandValidationService();
    const validation = validationService.validateSQLQueries(queries);
    if (!validation.valid) {
        return res.status(400).json({
            error: 'Invalid query format',
            details: validation.errors
        });
    }

    try {
        const apiToken = req.session.decryptedApiToken;
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        // Delegate to service
        const serviceExecutionService = new ServiceExecutionService();
        const results = await serviceExecutionService.executeSQLQueries(
            projectId,
            environment,
            queries,
            apiToken,
            userId
        );

        res.json({
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            results
        });
    } catch (error) {
        logger.error('Query execution failed:', {
            error: error.message,
            projectId,
            environment,
            userId
        });

        const statusCode = error.message.includes('authentication') ? 401
            : error.message.includes('No nodes found') ? 404
                : 500;

        res.status(statusCode).json({
            error: 'Query execution failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

export { runQueries };