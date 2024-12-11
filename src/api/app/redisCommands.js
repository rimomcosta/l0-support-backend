// src/api/app/redisCommands.js
import { logger } from '../../services/logger.js';
import { tunnelManager } from '../../services/tunnelService.js';
import { RedisCliService } from '../../services/redisCliService.js';

export async function runQueries(req, res) {
    const { projectId, environment } = req.params;
    const { queries } = req.body;

    if (!Array.isArray(queries)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Queries must be an array'
        });
    }

    try {
        // Get Redis-specific tunnel info
        const tunnelInfo = await tunnelManager.getServiceTunnelInfo(projectId, environment, 'redis');
        const redisService = new RedisCliService(tunnelInfo);

        const results = [];

        for (const query of queries) {
            const queryResult = {
                id: query.id,
                title: query.title,
                query: query.query,
                results: []
            };

            try {
                const output = await redisService.executeCommand(query.query);
                queryResult.results.push({
                    output,
                    error: null
                });
            } catch (error) {
                logger.error('Redis query execution failed:', {
                    error: error.message,
                    query: query.title
                });
                queryResult.results.push({
                    output: null,
                    error: error.message
                });
            }

            results.push(queryResult);
        }

        res.json({
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            results
        });
    } catch (error) {
        logger.error('Redis query execution failed:', {
            error: error.message,
            projectId,
            environment
        });

        const statusCode = error.message.includes('access denied') ? 401 : 500;
        res.status(statusCode).json({
            error: 'Query execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}