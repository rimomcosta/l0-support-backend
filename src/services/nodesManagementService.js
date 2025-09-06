// src/services/nodesManagementService.js
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

export class NodesManagementService {
    /**
     * Fetches all nodes for a given project and environment.
     * 
     * @param {string} projectId - Magento Cloud project identifier
     * @param {string} environment - Environment name (e.g., 'production', 'staging')
     * @param {string} apiToken - The user's API token
     * @param {string} userId - User ID
     * @returns {Promise<Array<Object>>} Array of node objects with id, sshUrl, and status
     */
    async execute(projectId, environment, apiToken, userId) {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        const { stdout } = await magentoCloud.executeCommand(
            `ssh -p ${projectId} -e ${environment} --all`,
            apiToken,
            userId
        );

        return stdout.split('\n')
            .filter(line => line.trim())
            .map((line, index) => ({
                id: index + 1,
                sshUrl: line.trim(),
                status: 'active'
            }));
    }

    /**
     * Gets nodes with error handling
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with nodes or error
     */
    async getNodes(projectId, environment, apiToken, userId) {
        try {
            logger.info('Fetching nodes', {
                projectId,
                environment,
                userId,
                timestamp: new Date().toISOString()
            });

            const nodes = await this.execute(projectId, environment, apiToken, userId);

            return {
                success: true,
                nodes,
                statusCode: 200
            };
        } catch (error) {
            logger.error('Failed to fetch nodes', {
                error: error.message,
                projectId,
                environment,
                userId,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                error: 'Failed to fetch nodes',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                statusCode: 500
            };
        }
    }
}
