// src/api/app/magentoCloudDirectAccess.js
import { MagentoCloudDirectAccessService } from '../../services/magentoCloudDirectAccessService.js';

// Export the executeCommand function for backward compatibility with other modules
export async function executeCommand(magentoCloud, command, context, apiToken, userId) {
    const service = new MagentoCloudDirectAccessService();
    return await service.executeCommand(magentoCloud, command, context, apiToken, userId);
}

/**
 * Handles the execution of multiple Magento Cloud CLI commands.
 * @param {Object} req - The Express request object
 * @param {Object} res - The Express response object
 */
export async function executeCommands(req, res) {
    const { projectId, environment, instance } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken;

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    if (!apiToken) {
        return res.status(401).json({ error: 'API token not found for user' });
    }

    try {
        // Delegate to service
        const service = new MagentoCloudDirectAccessService();
        const result = await service.executeCommands(projectId, environment, instance, commands, apiToken, userId);

        res.status(result.statusCode).json(result.success ? {
            projectId: result.projectId,
            environment: result.environment,
            instance: result.instance,
            timestamp: result.timestamp,
            results: result.results
        } : {
            error: result.error,
            details: result.details
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Handles the execution of SSH commands.
 * @param {Object} req - The Express request object
 * @param {Object} res - The Express response object
 */
export async function executeSSHCommand(req, res) {
    const { projectId, environment } = req.params;
    const { command } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken;

    if (!command) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Command must be provided'
        });
    }

    if (!apiToken) {
        return res.status(401).json({ error: 'API token not found for user' });
    }

    try {
        // Delegate to service
        const service = new MagentoCloudDirectAccessService();
        const result = await service.executeSSHCommand(projectId, environment, command, apiToken, userId);

        if (!result.success) {
            return res.status(result.statusCode).json({
                error: result.error,
                details: result.details
            });
        }

        // Set headers for streaming
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');

        // Stream stdout to the client
        result.tunnelProcess.stdout.on('data', (data) => {
            res.write(data);
        });

        // Stream stderr to the client
        result.tunnelProcess.stderr.on('data', (data) => {
            res.write(data);
        });

        // Handle process exit
        result.tunnelProcess.on('close', (code) => {
            res.end(`\nProcess exited with code ${code}`);
        });

        // Handle errors
        result.tunnelProcess.on('error', (err) => {
            res.status(500).end('SSH process encountered an error.');
        });

    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
