// src/api/app/environment.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { isAuthenticationError } from '../../middleware/errorHandler.js';

async function listEnvironments(projectId, apiToken, userId) {
    const magentoCloud = new MagentoCloudAdapter();
    await magentoCloud.validateExecutable();

    // Use --format=csv for more reliable parsing
    const { stdout, stderr } = await magentoCloud.executeCommand(`environment:list -p ${projectId} --format=csv`, apiToken, userId);
    const output = stdout + stderr;



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



        if (cells.length >= 4 && (cells[2] === 'Active' || cells[2] === 'In progress')) {
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
        // Check if this is an authentication error
        if (isAuthenticationError(error)) {
            logger.warn('API token authentication failed', {
                projectId,
                userId,
                errorMessage: error.message,
                timestamp: new Date().toISOString()
            });

            return res.status(401).json({
                error: 'Authentication failed',
                message: 'Your API token appears to be invalid or revoked. Please update your API token.',
                code: 'TOKEN_INVALID'
            });
        }

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