// src/api/app/sshCommands.js
import { logger, sshLogger, logSSHOperation } from '../../services/logger.js';
import { CommandValidationService } from '../../services/commandValidationService.js';
import { ServiceExecutionService } from '../../services/serviceExecutionService.js';

// Business logic moved to ServiceExecutionService

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken;

    logSSHOperation('info', 'Received SSH commands request', {
        projectId: projectId,
        environment: environment,
        userId: userId,
        commandCount: commands.length,
        commands: commands.map(cmd => ({
            id: cmd.id,
            title: cmd.title,
            command: cmd.command,
            allowAi: cmd.allowAi,
            executeOnAllNodes: cmd.executeOnAllNodes
        })),
        hasApiToken: !!apiToken,
        timestamp: new Date().toISOString()
    });

    // Validate commands using service
    const validationService = new CommandValidationService();
    const validation = validationService.validateSSHCommands(commands);

    if (!validation.valid) {
        logSSHOperation('error', 'Command validation failed', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            validationErrors: validation.errors,
            timestamp: new Date().toISOString()
        });
        
        return res.status(400).json({
            error: 'Command validation failed',
            details: validation.errors
        });
    }

    try {
        // Delegate to service
        const serviceExecutionService = new ServiceExecutionService();
        const result = await serviceExecutionService.executeSSHCommands(
            projectId,
            environment,
            commands,
            apiToken,
            userId
        );

        res.json(result);

    } catch (error) {
        logSSHOperation('error', 'SSH command execution process failed', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Failed to execute SSH commands',
            message: error.message
        });
    }
}
