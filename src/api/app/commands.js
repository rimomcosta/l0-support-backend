// src/api/app/commands.js
'use strict';

import { CommandService } from '../../services/commandsManagerService.js';
import { CommandExecutionService } from '../../services/commandExecutionService.js';
import { UserActivityService } from '../../services/userActivityService.js';
import { logger } from '../../services/logger.js';

const commandService = new CommandService();
const commandExecutionService = new CommandExecutionService();

// Service handlers moved to CommandExecutionService

// executeServiceCommands moved to CommandExecutionService

// Detect if a command should use bash service
function shouldUseBashService(command) {
    // List of bash operators and special characters that indicate bash usage
    const bashOperators = ['|', '>', '>>', '<<', '&&', '||', ';', '`', '$(',
        'grep', 'awk', 'sed', 'xargs', 'find', 'sort', 'uniq'];

    return bashOperators.some(operator => command.includes(operator));
}

// Execute all commands
export async function executeAllCommands(req, res) {
    console.log('=== executeAllCommands CALLED ===', {
        projectId: req.params.projectId,
        environment: req.params.environment,
        url: req.url,
        method: req.method
    });
    
    try {
        const { projectId, environment } = req.params;
        const userId = req.session.user.id;
        const tabId = req.query.tabId;
        const apiToken = req.session.decryptedApiToken;
        
        // Validate session is still active
        if (!req.session || !req.session.user) {
            logger.error('Invalid session in executeAllCommands', {
                projectId,
                environment,
                hasSession: !!req.session,
                hasUser: !!req.session?.user
            });
            return res.status(401).json({ 
                error: 'Session expired', 
                code: 'SESSION_EXPIRED',
                message: 'Your session has expired. Please log in again.' 
            });
        }
        
        if (!apiToken) {
            logger.error('No decrypted API token found', {
                projectId,
                environment,
                userId,
                sessionId: req.sessionID
            });
            return res.status(401).json({ error: 'Decrypted API token not found in session' });
        }

        // Delegate to service
        const finalResults = await commandExecutionService.executeAllCommands(
            projectId,
            environment,
            userId,
            apiToken,
            tabId,
            req.sessionID,
            req.session.user.groups,
            req.ip,
            req.get('User-Agent')
        );

        res.json(finalResults);

    } catch (error) {
        console.error('=== ERROR IN executeAllCommands ===', {
            error: error.message,
            stack: error.stack,
            projectId: req.params.projectId,
            environment: req.params.environment
        });
        
        logger.error('Failed to execute commands:', {
            error: error.message,
            errorStack: error.stack,
            projectId: req.params.projectId,
            environment: req.params.environment,
            userId: req.session?.user?.id,
            sessionId: req.sessionID
        });

        // Create a more user-friendly error message
        let userFriendlyMessage = 'Failed to execute commands';
        let shouldRetry = false;
        
        if (error.message.includes('tunnel failed health check') || error.message.includes('New tunnel failed health check')) {
            userFriendlyMessage = 'Tunnel connection failed. This is a temporary issue with the cloud environment.';
            shouldRetry = true;
        } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
            userFriendlyMessage = 'Request timed out. The service may be temporarily unavailable.';
            shouldRetry = true;
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('connection refused')) {
            userFriendlyMessage = 'Connection refused. The service may be temporarily unavailable.';
            shouldRetry = true;
        } else if (error.message.includes('authentication') || error.message.includes('unauthorized')) {
            userFriendlyMessage = 'Authentication failed. Please check your credentials and try again.';
            shouldRetry = false;
        } else if (error.message.includes('not found') || error.message.includes('404')) {
            userFriendlyMessage = 'Resource not found. Please check the project ID and environment.';
            shouldRetry = false;
        }
        
        const errorResponse = {
            error: userFriendlyMessage,
            details: error.message,
            shouldRetry: shouldRetry,
            timestamp: new Date().toISOString()
        };

        WebSocketService.broadcastToTab({
            type: 'execution_error',
            timestamp: new Date().toISOString(),
            error: errorResponse
        }, req.query.tabId);

        res.status(500).json(errorResponse);
    }
}

export async function refreshService(req, res) {
    const { serviceType, projectId, environment, tabId } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken;

    if (!serviceType || !projectId || !environment) {
        return res.status(400).json({ error: 'Service type, project ID, and environment are required' });
    }

    try {
        // Delegate to service
        const result = await commandExecutionService.refreshService(
            serviceType,
            projectId,
            environment,
            userId,
            apiToken,
            tabId
        );

        res.json(result);

    } catch (error) {
        logger.error(`Failed to refresh ${serviceType} service:`, {
            error: error.message,
            projectId,
            environment,
            userId,
            tabId
        });

        res.status(500).json({
            error: `Failed to refresh ${serviceType} service`,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// CRUD Operations
export async function getCommand(req, res) {
    try {
        const command = await commandService.getById(req.params.id);
        res.json(command);
    } catch (error) {
        logger.error('Failed to get command:', error);
        res.status(500).json({ error: error.message });
    }
}

export async function getCommands(req, res) {
    try {
        const commands = await commandService.getAll();
        // Group commands by service type for the response
        const groupedCommands = commands.reduce((acc, cmd) => {
            acc[cmd.service_type] = acc[cmd.service_type] || [];
            acc[cmd.service_type].push(cmd);
            return acc;
        }, {});
        res.json(groupedCommands);
    } catch (error) {
        logger.error('Failed to get commands:', error);
        res.status(500).json({ error: error.message });
    }
}

export async function createCommand(req, res) {
    try {
        const id = await commandService.create(req.body);
        
        // Track command creation activity
        try {
            const userSession = {
                id: req.session.user.id,
                sessionId: req.sessionID,
                groups: req.session.user.groups,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            };

            await UserActivityService.trackCommandCreation(userSession, {
                command_id: id,
                command_name: req.body.title,
                command_type: req.body.service_type,
                project_id: req.body.project_id,
                environment: req.body.environment
            });
        } catch (trackingError) {
            logger.error('Failed to track command creation activity:', trackingError);
        }

        res.status(201).json({ id });
    } catch (error) {
        logger.error('Failed to create command:', error);
        res.status(500).json({ error: error.message });
    }
}

export async function updateCommand(req, res) {
    try {
        await commandService.update(req.params.id, req.body);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Failed to update command:', error);
        res.status(500).json({ error: error.message });
    }
}

export async function toggleCommand(req, res) {
    try {
        // Pass req.session.user as the third parameter
        const result = await commandService.updateToggle(req.params.id, req.body, req.session.user);
        res.status(200).json(result);
    } catch (error) {
        logger.error('Failed to toggle command field:', error);
        
        // Check if it's an authorization error
        if (error.message === 'This action requires admin role') {
            res.status(403).json({ 
                error: 'Access denied. Admin privileges required.',
                code: 'ADMIN_REQUIRED'
            });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
}

export async function deleteCommand(req, res) {
    try {
        await commandService.delete(req.params.id);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Failed to delete command:', error);
        res.status(500).json({ error: error.message });
    }
}

export async function executeSingleCommand(req, res) {
    const { commandId, projectId } = req.body;
    const environment = req.body.environment || null;
    const userId = req.session?.user?.id;
    const tabId = req.query.tabId || req.body.tabId;
    const apiToken = req.session.decryptedApiToken;

    if (!commandId || !projectId) {
        return res.status(400).json({ error: 'Command ID and project ID are required' });
    }

    try {
        // Get API token for the user
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        // Delegate to service
        const result = await commandExecutionService.executeSingleCommand(
            commandId,
            projectId,
            environment,
            userId,
            apiToken,
            tabId
        );

            res.json(result);

    } catch (error) {
        logger.error('Failed to execute single command:', {
            error: error.message,
            stack: error.stack,
            projectId,
            environment,
            commandId,
            userId,
            tabId,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Failed to execute command',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
}