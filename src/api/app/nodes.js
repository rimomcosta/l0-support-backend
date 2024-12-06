// src/api/app/nodes.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';

/**
 * Fetches all nodes for a given project and environment.
 * 
 * @param {string} projectId - Magento Cloud project identifier
 * @param {string} environment - Environment name (e.g., 'production', 'staging')
 * @returns {Promise<Array<Object>>} Array of node objects with id, sshUrl, and status
 */
export async function execute(projectId, environment) {
    const magentoCloud = new MagentoCloudAdapter();
    await magentoCloud.validateExecutable();
    
    const { stdout } = await magentoCloud.executeCommand(
        `ssh -p ${projectId} -e ${environment} --all`
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

    try {
        logger.info('Fetching nodes', {
            projectId,
            environment,
            timestamp: new Date().toISOString()
        });

        const nodes = await execute(projectId, environment);
        res.json({ nodes });
    } catch (error) {
        logger.error('Failed to fetch nodes', {
            error: error.message,
            projectId,
            environment,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Failed to fetch nodes',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}