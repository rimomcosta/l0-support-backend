// src/api/app/nodes.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { ApiTokenService } from '../../services/apiTokenService.js'; // Import ApiTokenService

/**
 * Fetches all nodes for a given project and environment.
 * 
 * @param {string} projectId - Magento Cloud project identifier
 * @param {string} environment - Environment name (e.g., 'production', 'staging')
 * @param {string} apiToken - The user's API token
 * @returns {Promise<Array<Object>>} Array of node objects with id, sshUrl, and status
 */
export async function execute(projectId, environment, apiToken) {
    const magentoCloud = new MagentoCloudAdapter();
    await magentoCloud.validateExecutable();

    const { stdout } = await magentoCloud.executeCommand(
        `ssh -p ${projectId} -e ${environment} --all`,
        apiToken // Pass apiToken
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
 * API handler for getting nodes information.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getNodes(req, res) {
    const { projectId, environment } = req.params;
    const userId = req.session.user.id; // Get userId

    try {
        logger.info('Fetching nodes', {
            projectId,
            environment,
            userId,
            timestamp: new Date().toISOString()
        });

        const apiToken = await ApiTokenService.getApiToken(userId); // Get API token
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        const nodes = await execute(projectId, environment, apiToken); // Pass apiToken
        res.json({ nodes });
    } catch (error) {
        logger.error('Failed to fetch nodes', {
            error: error.message,
            projectId,
            environment,
            userId,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Failed to fetch nodes',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}