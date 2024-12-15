// src/api/app/openSearchCommands.js
import { logger } from '../../services/logger.js';
import { tunnelManager } from '../../services/tunnelService.js';
import { OpenSearchService } from '../../services/openSearchService.js';

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
        const tunnelInfo = await tunnelManager.openTunnel(projectId, environment);
        const searchService = new OpenSearchService(tunnelInfo);

        const results = [];

        for (const query of queries) {
            const queryResult = {
                id: query.id,
                title: query.title,
                query: query.command,
                results: []
            };

            try {
                const output = await searchService.executeCommand(query.command);
                queryResult.results.push({
                    nodeId: 'tunnel',
                    output, // Output is already parsed JSON
                    error: null,
                    status: 'SUCCESS'
                });
            } catch (error) {
                logger.error('OpenSearch query execution failed:', {
                    error: error.message,
                    query: query.title
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
        logger.error('OpenSearch query execution failed:', {
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