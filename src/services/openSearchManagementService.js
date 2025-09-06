// src/services/openSearchManagementService.js
import { logger } from './logger.js';
import { tunnelManager } from './tunnelService.js';
import { OpenSearchService } from './openSearchService.js';

export class OpenSearchManagementService {
    /**
     * Executes a set of queries against the search service (OpenSearch or Elasticsearch).
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {Array} queries - Array of queries
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with query results
     */
    async runQueries(projectId, environment, queries, apiToken, userId) {
        try {
            // Attempt to retrieve tunnel info for 'opensearch'
            let tunnelInfo = await tunnelManager.getServiceTunnelInfo(projectId, environment, 'opensearch', apiToken, userId);
            let serviceName = 'opensearch';

            if (!tunnelInfo || !tunnelInfo['opensearch'] || tunnelInfo['opensearch'].length === 0) {
                // If 'opensearch' is not available, attempt to retrieve 'elasticsearch'
                logger.debug(`'opensearch' not available. Attempting to retrieve 'elasticsearch' tunnel info.`, {
                    projectId,
                    environment
                });

                tunnelInfo = await tunnelManager.getServiceTunnelInfo(projectId, environment, 'elasticsearch', apiToken, userId);
                serviceName = 'elasticsearch';
            }

            if (!tunnelInfo || !tunnelInfo[serviceName] || tunnelInfo[serviceName].length === 0) {
                throw new Error(`Neither opensearch nor elasticsearch services are available in the tunnel configuration`);
            }

            const searchService = new OpenSearchService(tunnelInfo, serviceName);

            const results = [];

            for (const query of queries) {
                const queryResult = {
                    id: query.id,
                    title: query.title,
                    query: query.command,
                    results: [],
                    allowAi: query.allowAi
                };

                try {
                    const output = await searchService.executeCommand(query.command);
                    queryResult.results.push({
                        nodeId: 'tunnel',
                        output, // Output is already parsed JSON or text
                        error: null,
                        status: 'SUCCESS'
                    });
                } catch (error) {
                    logger.error('OpenSearch query execution failed:', {
                        error: error.message,
                        query: query.title,
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

            return {
                success: true,
                projectId,
                environment,
                timestamp: new Date().toISOString(),
                results,
                statusCode: 200
            };
        } catch (error) {
            logger.error('OpenSearch query execution failed:', {
                error: error.message,
                projectId,
                environment,
                userId
            });

            const statusCode = error.message.includes('access denied') ? 401 : 500;
            return {
                success: false,
                error: 'Query execution failed',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                statusCode
            };
        }
    }
}
