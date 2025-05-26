// src/api/app/rabbitmqCommands.js
import { logger } from '../../services/logger.js';
import { RabbitMQAdminService } from '../../services/rabbitmqAdminService.js';

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id; // Get userId
    const apiToken = req.session.decryptedApiToken;

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    try {
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        // Initialize RabbitMQAdminService with projectId, environment, and apiToken
        const rabbitmqService = new RabbitMQAdminService(projectId, environment, apiToken, userId);
const results = [];

        for (const command of commands) {
            const commandResult = {
                id: command.id,
                title: command.title,
                command: command.command,
                results: [],
                allowAi: command.allowAi
            };

            try {
                const output = await rabbitmqService.executeCommand(command.command);
                commandResult.results.push({
                    nodeId: 'single-node', // Update as needed for your use case
                    output,
                    error: null,
                    status: 'SUCCESS'
                });
            } catch (error) {
                logger.error('RabbitMQ command execution failed:', {
                    error: error.message,
                    command: command.title
                });
                commandResult.results.push({
                    nodeId: 'single-node', // Update as needed for your use case
                    output: null,
                    error: error.message,
                    status: 'ERROR'
                });
            }

            commandResult.summary = {
                total: commandResult.results.length,
                successful: commandResult.results.filter(r => r.status === 'SUCCESS').length,
                failed: commandResult.results.filter(r => r.status === 'ERROR').length
            };

            results.push(commandResult);
        }

        res.json({
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            results
        });
    } catch (error) {
        logger.error('RabbitMQ command execution failed:', {
            error: error.message,
            projectId,
            environment,
            userId
        });

        const statusCode = error.message.includes('access denied') ? 401 : 500;
        res.status(statusCode).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}