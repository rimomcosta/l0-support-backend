// src/api/app/rabbitmqCommands.js
import { logger } from '../../services/logger.js';
import { CommandValidationService } from '../../services/commandValidationService.js';
import { ServiceExecutionService } from '../../services/serviceExecutionService.js';

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
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

    // Validate commands using service
    const validationService = new CommandValidationService();
    const validation = validationService.validateRabbitMQCommands(commands);
    if (!validation.valid) {
        return res.status(400).json({
            error: 'Invalid command format',
            details: validation.errors
        });
    }

    try {
        // Delegate to service
        const serviceExecutionService = new ServiceExecutionService();
        const result = await serviceExecutionService.executeRabbitMQCommands(
            projectId,
            environment,
            commands,
            apiToken,
            userId
        );

        res.json(result);
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