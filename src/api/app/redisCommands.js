// src/api/app/redisCommands.js
import { logger } from '../../services/logger.js';
import { CommandValidationService } from '../../services/commandValidationService.js';
import { ServiceExecutionService } from '../../services/serviceExecutionService.js';

export async function runQueries(req, res) {
    const { projectId, environment } = req.params;
    const { queries } = req.body;
    const apiToken = req.session.decryptedApiToken;
    const userId = req.session.user?.id; // Extract userId from session

    // Avoid logging sensitive information like apiToken
    if (!userId) {
        return res.status(401).json({ error: 'User ID not found in session' });
    }

    // Validate queries using service
    const validationService = new CommandValidationService();
    const validation = validationService.validateRedisCommands(queries);
    if (!validation.valid) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: validation.errors
        });
    }

    try {
        // Delegate to service
        const serviceExecutionService = new ServiceExecutionService();
        const result = await serviceExecutionService.executeRedisCommands(
            projectId,
            environment,
            queries,
            apiToken,
            userId
        );

        res.json(result);
    } catch (error) {
        logger.error('Redis query execution failed:', {
            error: error.message,
            projectId,
            environment,
            userId
        });

        const statusCode = error.message.includes('access denied') ? 401 : 500;
        res.status(statusCode).json({
            error: 'Query execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
