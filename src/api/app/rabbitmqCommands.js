// src/api/app/rabbitmqCommands.js
import { logger } from '../../services/logger.js';
import { RabbitMQAdminService } from '../../services/rabbitmqAdminService.js';

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    try {
        // Initialize RabbitMQAdminService with projectId and environment
        const rabbitmqService = new RabbitMQAdminService(projectId, environment);

        const results = [];

        for (const command of commands) {
            const commandResult = {
                id: command.id,
                title: command.title,
                command: command.command,
                results: []
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
            environment
        });

        const statusCode = error.message.includes('access denied') ? 401 : 500;
        res.status(statusCode).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}