// src/api/app/environment.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
// import { ApiTokenService } from '../../services/apiTokenService.js'; // Import ApiTokenService

async function listEnvironments(projectId, apiToken, userId) {
    const magentoCloud = new MagentoCloudAdapter();
    await magentoCloud.validateExecutable();

    // Use --format=csv for more reliable parsing
    const { stdout, stderr } = await magentoCloud.executeCommand(`environment:list -p ${projectId} --format=csv`, apiToken, userId);
    const output = stdout + stderr;

    // Debug logging for problematic project
    if (projectId === 'v4xd4x7rbiybi') {
        logger.info('Raw environment output for v4xd4x7rbiybi:', { output });
    }

    const lines = output.split('\n').filter(line => line.trim());
    
    // Skip the CSV header
    if (lines.length === 0 || !lines[0].includes('ID')) {
        throw new Error('Could not find CSV header in command output');
    }

    const environments = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Parse CSV - handle quoted fields
        const cells = line.split(',').map(cell => cell.trim());

        // Debug logging for problematic project
        if (projectId === 'v4xd4x7rbiybi' && cells.length >= 4) {
            logger.info('Parsing environment line:', { 
                line,
                cells,
                id: cells[0],
                title: cells[1],
                status: cells[2],
                type: cells[3]
            });
        }

        if (cells.length >= 4 && cells[2] === 'Active') {
            environments.push({
                id: cells[0],
                title: cells[1],
                status: cells[2],
                type: cells[3]
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
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        const environments = await listEnvironments(projectId, apiToken, userId);

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