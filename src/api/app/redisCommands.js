// src/api/app/redisCommands.js
import { logger } from '../../services/logger.js';
import { tunnelManager } from '../../services/tunnelService.js';
import { RedisCliService } from '../../services/redisCliService.js';

export async function runQueries(req, res) {
    const { projectId, environment } = req.params;
    const { queries } = req.body;
    const apiToken = req.session.decryptedApiToken;
    const userId = req.session.user?.id; // Extract userId from session

    // Avoid logging sensitive information like apiToken
    console.log('Executing Redis queries for user:', userId);

    if (!userId) {
        return res.status(401).json({ error: 'User ID not found in session' });
    }

    if (!Array.isArray(queries)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Queries must be an array'
        });
    }

    try {
        // Get Redis-specific tunnel info, passing userId
        const tunnelInfo = await tunnelManager.getServiceTunnelInfo(projectId, environment, 'redis', apiToken, userId);
        
        if (!tunnelInfo) {
            logger.error('Failed to retrieve tunnel information for Redis', {
                projectId,
                environment,
                userId
            });
            return res.status(500).json({ error: 'Failed to retrieve tunnel information' });
        }

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
                    nodeId: 'tunnel',
                    output,
                    error: null,
                    status: 'SUCCESS'
                });
            } catch (error) {
                logger.error('Redis query execution failed:', {
                    error: error.message,
                    query: query.title,
                    projectId,
                    environment,
                    userId
                });
                queryResult.results.push({
                    nodeId: 'tunnel',
                    output: null,
                    error: error.message,
                    status: 'ERROR'
                });
            }
            
            queryResult.summary = {
                total: queryResult.results.length,
                successful: queryResult.results.filter(r => r.status === 'SUCCESS').length,
                failed: queryResult.results.filter(r => r.status === 'ERROR').length
            };

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
