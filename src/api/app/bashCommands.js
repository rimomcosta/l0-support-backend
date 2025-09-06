// src/api/app/bashCommands.js
import { logger } from '../../services/logger.js';
import { CommandValidationService } from '../../services/commandValidationService.js';
import { ServiceExecutionService } from '../../services/serviceExecutionService.js';

// Business logic moved to ServiceExecutionService

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
    const validation = validationService.validateBashCommands(commands);
    if (!validation.valid) {
        return res.status(400).json({
            error: 'Invalid command format',
            details: validation.errors
        });
    }

    try {
        const context = {
            projectId,
            environment,
            instance: null // bash service doesn't typically use instance
        };

        // Delegate to service
        const serviceExecutionService = new ServiceExecutionService();
        const result = await serviceExecutionService.executeBashCommands(
            commands,
            userId,
            context,
            apiToken
        );

        res.json(result);
    } catch (error) {
        logger.error('Bash command execution failed:', {
            error: error.message,
            userId,
            projectId,
            environment
        });

        res.status(500).json({
            error: 'Bash command execution failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}