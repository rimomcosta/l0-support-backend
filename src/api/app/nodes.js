// src/api/app/nodes.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';

async function execute(projectId, environment) {
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