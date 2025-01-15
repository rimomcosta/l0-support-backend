// src/api/app/environment.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
// import { ApiTokenService } from '../../services/apiTokenService.js'; // Import ApiTokenService

async function listEnvironments(projectId, apiToken) {
    console.log('apiToken in environment:listEnvironments=====>', apiToken);
    const magentoCloud = new MagentoCloudAdapter();
    await magentoCloud.validateExecutable();

    const { stdout, stderr } = await magentoCloud.executeCommand(`environment:list -p ${projectId}`, apiToken); // Pass apiToken
    const output = stdout + stderr;

    const lines = output.split('\n').filter(line => line.trim());
    const headerIndex = lines.findIndex(line => line.includes('| ID'));

    if (headerIndex === -1) {
        throw new Error('Could not find table header in command output');
    }

    const environments = [];
    for (let i = headerIndex + 2; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('+')) continue;

        const cells = line.split('|').map(cell => cell.trim());

        if (cells.length >= 5 && cells[3] === 'Active') {
            environments.push({
                id: cells[1],
                title: cells[2],
                status: cells[3],
                type: cells[4]
            });
        }
    }

    return environments;
}

export async function getEnvironments(req, res) {
    const { projectId } = req.params;
    const userId = req.session.user.id;

    try {
        const apiToken = req.session.decryptedApiToken;
        console.log('apiToken in environment:getEnvironments=====>', apiToken);
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        const environments = await listEnvironments(projectId, apiToken);

        if (environments.length === 0) {
            logger.warn('No active environments found', {
                projectId,
                userId,
                timestamp: new Date().toISOString()
            });
        }

        res.json(environments);
    } catch (error) {
        logger.error('Environment fetch failed', {
            error: error.message,
            projectId,
            userId,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Failed to fetch environments',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}