// src/api/app/commands.js
'use strict';

import { CommandService } from '../../services/commandsManagerService.js';
import { WebSocketService } from '../../services/webSocketService.js';
import { logger } from '../../services/logger.js';
import { tunnelManager } from '../../services/tunnelService.js';
import { ApiTokenService } from '../../services/apiTokenService.js';
import * as sshCommands from './sshCommands.js';
import * as sqlCommands from './sqlCommands.js';
import * as redisCommands from './redisCommands.js';
import * as openSearchCommands from './openSearchCommands.js';
import * as magentoCloudDirectAccess from './magentoCloudDirectAccess.js';
import * as bashCommands from './bashCommands.js';
import * as rabbitmqCommands from './rabbitmqCommands.js';

const commandService = new CommandService();

const SERVICE_HANDLERS = {
    ssh: {
        handler: sshCommands.runCommands,
        preparePayload: (commands, projectId, environment, apiToken) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                executeOnAllNodes: Boolean(cmd.execute_on_all_nodes),
                apiToken: apiToken
            }))
        })
    },
    rabbitmq: {
        handler: rabbitmqCommands.runCommands,
        preparePayload: (commands, projectId, environment, apiToken) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command, // Use "command" for RabbitMQ
                apiToken: apiToken
            }))
        })
    },
    bash: {
        handler: bashCommands.runCommands,
        preparePayload: (commands, projectId, environment, apiToken) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                apiToken: apiToken
            }))
        })
    },
    sql: {
        handler: sqlCommands.runQueries,
        preparePayload: (commands, projectId, environment, apiToken) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command,
                executeOnAllNodes: Boolean(cmd.execute_on_all_nodes),
                apiToken: apiToken
            }))
        })
    },
    redis: {
        handler: redisCommands.runQueries,
        preparePayload: (commands, projectId, environment, apiToken) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command,
                apiToken: apiToken
            }))
        })
    },
    opensearch: {
        handler: openSearchCommands.runQueries,
        preparePayload: (commands, projectId, environment, apiToken) => ({
            queries: commands.map(cmd => {
                const config = typeof cmd.command === 'string'
                    ? JSON.parse(cmd.command)
                    : cmd.command;
                return {
                    id: cmd.id,
                    title: cmd.title,
                    command: config,
                    apiToken: apiToken
                };
            })
        })
    },
    magento_cloud: {
        handler: magentoCloudDirectAccess.executeCommands,
        preparePayload: (commands, projectId, environment, apiToken) => ({
            commands: commands.map(cmd => {
                let command = cmd.command;
                command = command
                    .replace(/:projectid/g, projectId)
                    .replace(/:environment/g, environment || '')
                    // Note: instanceid will be handled by the magentoCloudDirectAccess handler
                    .replace(/--p\s+/g, '--project ') // Normalize project flag
                    .replace(/-project\s+/g, '-p '); // Normalize project flag

                return {
                    id: cmd.id,
                    title: cmd.title,
                    command: command,
                    apiToken: apiToken
                };
            })
        })
    }
};

async function executeServiceCommands(serviceType, commands, projectId, environment, userId, apiToken) {
    console.log('apiToken in commands:executeServiceCommands=====>', apiToken);
    if (!commands || commands.length === 0) return null;

    const serviceHandler = SERVICE_HANDLERS[serviceType];
    if (!serviceHandler) {
        throw new Error(`Unsupported service type: ${serviceType}`);
    }

    const { handler, preparePayload } = serviceHandler;

    // Removed: tunnelManager.userId = userId;

    // Group commands that require tunnels
    let tunnelNeeded = ['redis', 'sql', 'opensearch'].includes(serviceType);
    let tunnelInfo = null;

    if (tunnelNeeded) {
        try {
            // Pass userId to openTunnel
            tunnelInfo = await tunnelManager.openTunnel(projectId, environment, apiToken, userId);
            if (!tunnelInfo) {
                throw new Error('Tunnel information is unavailable after opening.');
            }
        } catch (error) {
            logger.error(`Failed to establish tunnel for ${serviceType}`, {
                error: error.message,
                projectId,
                environment,
                userId
            });
            throw error;
        }
    }

    const request = {
        params: {
            projectId,
            environment,
            tunnelInfo
        },
        body: preparePayload(commands, projectId, environment, apiToken),
        session: {
            user: {
                id: userId
            },
            decryptedApiToken: apiToken
        }
    };

    const responseHandler = {
        status: function (code) {
            this.statusCode = code;
            return this;
        },
        json: function (data) {
            this.data = data;
            return this;
        }
    };

    try {
        await handler(request, responseHandler);
        return responseHandler.data;
    } catch (error) {
        logger.error(`Error executing ${serviceType} commands:`, {
            error: error.message,
            projectId,
            environment,
            userId
        });
        throw error;
    }
}

// Detect if a command should use bash service
function shouldUseBashService(command) {
    // List of bash operators and special characters that indicate bash usage
    const bashOperators = ['|', '>', '>>', '<<', '&&', '||', ';', '`', '$(',
        'grep', 'awk', 'sed', 'xargs', 'find', 'sort', 'uniq'];

    return bashOperators.some(operator => command.includes(operator));
}

// Execute all commands
export async function executeAllCommands(req, res) {
    const { projectId, environment } = req.params;
    const userId = req.session.user.id;
    const tabId = req.query.tabId;
    const apiToken = req.session.decryptedApiToken;
    console.log('apiToken in commands:executeAllCommands=====>', apiToken);
    if (!apiToken) {
        return res.status(401).json({ error: 'Decrypted API token not found in session' });
    }

    try {
        const allCommands = await commandService.getAll();
        const commandsToRun = allCommands.filter(cmd => cmd.auto_run && cmd.reviewed);
        const commandsByService = commandsToRun.reduce((acc, cmd) => {
            acc[cmd.service_type] = acc[cmd.service_type] || [];
            acc[cmd.service_type].push({
                ...cmd,
                command: cmd.command,
                execute_on_all_nodes: Boolean(cmd.execute_on_all_nodes)
            });
            return acc;
        }, {});

        // Send initial status to client using tabId
        WebSocketService.broadcastToTab({
            type: 'execution_started',
            timestamp: new Date().toISOString(),
            services: Object.keys(commandsByService)
        }, tabId);

        // Execute services in parallel
        const servicePromises = Object.entries(commandsByService).map(
            async ([serviceType, commands]) => {
                try {
                    const serviceResults = await executeServiceCommands(
                        serviceType,
                        commands,
                        projectId,
                        environment,
                        userId,
                        apiToken
                    );

                    // Only send the results array in service_complete using tabId
                    WebSocketService.broadcastToTab({
                        type: 'service_complete',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        results: serviceResults.results // Just send the results array
                    }, tabId);

                    return { serviceType, results: serviceResults };
                } catch (error) {
                    WebSocketService.broadcastToTab({
                        type: 'service_error',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        error: error.message
                    }, tabId);

                    return {
                        serviceType,
                        error: error.message
                    };
                }
            }
        );

        // Wait for all services to complete
        const results = await Promise.all(servicePromises);

        // Only send a simple completion message without duplicating the results using tabId
        WebSocketService.broadcastToTab({
            type: 'execution_complete',
            timestamp: new Date().toISOString(),
            projectId,
            environment,
            summary: results.reduce((acc, result) => {
                acc[result.serviceType] = {
                    status: result.error ? 'error' : 'success',
                    error: result.error
                };
                return acc;
            }, {})
        }, tabId);

        // Transform results for the HTTP response
        const finalResults = {
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            services: results.reduce((acc, result) => {
                acc[result.serviceType] = result.results || {
                    error: result.error,
                    timestamp: new Date().toISOString()
                };
                return acc;
            }, {})
        };

        res.json(finalResults);

    } catch (error) {
        logger.error('Failed to execute commands:', {
            error: error.message,
            projectId,
            environment,
            userId
        });

        const errorResponse = {
            error: 'Failed to execute commands',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        };

        WebSocketService.broadcastToTab({
            type: 'execution_error',
            timestamp: new Date().toISOString(),
            error: errorResponse
        }, tabId);

        res.status(500).json(errorResponse);
    }
}

export async function refreshService(req, res) {
    const { serviceType, projectId, environment, tabId } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken;
    console.log('req.session in =======commands:executeSingleCommand=====>', req.session);
    console.log('req.session in =======commands:executeSingleCommand=====>', req.session);

    // Check if the session is expired
    if (req.session && req.session.cookie && req.session.cookie._expires) {
        const now = new Date();
        const expires = new Date(req.session.cookie._expires);

        if (now > expires) {
            console.log('Session status: Expired');
        } else {
            console.log('Session status: Active');
        }
    } else {
        console.log('Session status: Missing expiration info');
    }

    if (!serviceType || !projectId || !environment) {
        return res.status(400).json({ error: 'Service type, project ID, and environment are required' });
    }

    try {
        // Get all commands for this service type
        const allCommands = await commandService.getAll();
        const serviceCommands = allCommands.filter(cmd =>
            cmd.service_type === serviceType && cmd.auto_run && cmd.reviewed
        );

        if (serviceCommands.length === 0) {
            return res.json({ results: [] });
        }

        // Execute commands for this service
        const serviceResults = await executeServiceCommands(
            serviceType,
            serviceCommands,
            projectId,
            environment,
            userId,
            apiToken
        );

        // Broadcast the update through WebSocket using tabId
        WebSocketService.broadcastToTab({
            type: 'service_complete',
            serviceType,
            timestamp: new Date().toISOString(),
            results: serviceResults.results
        }, tabId);

        res.json({ results: serviceResults.results });

    } catch (error) {
        logger.error(`Failed to refresh ${serviceType} service:`, {
            error: error.message,
            projectId,
            environment,
            userId,
            tabId
        });

        WebSocketService.broadcastToTab({
            type: 'service_error',
            serviceType,
            timestamp: new Date().toISOString(),
            error: error.message
        }, tabId);

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
    const instance = req.body.instance || null;
    const userId = req.session?.user?.id;
    const tabId = req.query.tabId || req.body.tabId;
    const apiToken = req.session.decryptedApiToken;
    console.log('apiToken in commands:executeSingleCommand=====>', apiToken);

    logger.info('Executing single command:', {
        commandId,
        projectId,
        environment,
        userId,
        tabId,
        timestamp: new Date().toISOString()
    });

    if (!commandId || !projectId) {
        return res.status(400).json({ error: 'Command ID and project ID are required' });
    }

    try {
        // Get API token for the user
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        const command = await commandService.getById(commandId);
        if (!command || command.length === 0) {
            return res.status(404).json({ error: 'Command not found' });
        }

        const singleCommand = command[0];
        // Check if the command is reviewed
        if (!singleCommand.reviewed) {
            return res.status(403).json({ error: 'This command has not been reviewed and cannot be executed' });
        }

        // Ensure service_type is magento_cloud for magento-cloud commands
        const serviceType = singleCommand.service_type;

        // Get the service handler from SERVICE_HANDLERS
        const serviceHandler = SERVICE_HANDLERS[serviceType];
        if (!serviceHandler) {
            return res.status(400).json({ error: `Unsupported service type: ${serviceType}` });
        }

        // Execute the command using executeServiceCommands
        const result = await executeServiceCommands(
            serviceType,
            [singleCommand], // Pass as array with single command
            projectId,
            environment,
            userId,
            apiToken
        );

        // If execution was successful, send the response
        if (result) {
            // Store results in session storage if needed
            if (tabId) {
                WebSocketService.broadcastToTab({
                    type: 'command_complete',
                    commandId,
                    timestamp: new Date().toISOString(),
                    results: result
                }, tabId);
            }

            res.json(result);
        } else {
            throw new Error('Command execution returned no results');
        }

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
