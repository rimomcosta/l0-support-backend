// src/api/app/commands.js
import { CommandService } from '../../services/commandsManagerService.js';
import { WebSocketService } from '../../services/webSocketService.js';
import { logger } from '../../services/logger.js';
import { tunnelManager } from '../../services/tunnelService.js';
import * as sshCommands from './sshCommands.js';
import * as sqlCommands from './sqlCommands.js';
import * as redisCommands from './redisCommands.js';
import * as openSearchCommands from './openSearchCommands.js';
import * as magentoCloudDirectAccess from './magentoCloudDirectAccess.js';
import { aiService } from '../../services/aiService.js';
import * as bashCommands from './bashCommands.js';
import * as rabbitmqCommands from './rabbitmqCommands.js';
import { json } from 'express';

const commandService = new CommandService();

// AI Code Generation Endpoint
export async function generateComponentCode(req, res) {
    const { command, description, outputExample, aiGuidance } = req.body;

    if (!outputExample || !command) {
        return res.status(400).json({ error: 'Command, description and output example are required' });
    }

    try {
        const generatedCode = await aiService.generateComponentCode(command, description, outputExample, aiGuidance);
        res.json({ generatedCode });
    } catch (error) {
        logger.error('AI code generation failed:', error);
        res.status(500).json({ error: 'Failed to generate component code' });
    }
}

const SERVICE_HANDLERS = {
    ssh: {
        handler: sshCommands.runCommands,
        preparePayload: (commands) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                executeOnAllNodes: Boolean(cmd.execute_on_all_nodes)
            }))
        })
    },
    rabbitmq: {
        handler: rabbitmqCommands.runCommands,
        preparePayload: (commands) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command // Use "command" for RabbitMQ
            }))
        })
    },
    bash: {
        handler: bashCommands.runCommands,
        preparePayload: (commands) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command
            }))
        })
    },
    sql: {
        handler: sqlCommands.runQueries,
        preparePayload: (commands) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command,
                executeOnAllNodes: Boolean(cmd.execute_on_all_nodes)
            }))
        })
    },
    redis: {
        handler: redisCommands.runQueries,
        preparePayload: (commands) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command
            }))
        })
    },
    opensearch: {
        handler: openSearchCommands.runQueries,
        preparePayload: (commands) => ({
            queries: commands.map(cmd => {
                const config = typeof cmd.command === 'string'
                    ? JSON.parse(cmd.command)
                    : cmd.command;
                return {
                    id: cmd.id,
                    title: cmd.title,
                    command: config
                };
            })
        })
    },
    magento_cloud: {
        handler: magentoCloudDirectAccess.executeCommands,
        preparePayload: (commands, projectId, environment) => ({
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
                    command: command
                };
            })
        })
    }
};

async function executeServiceCommands(serviceType, commands, projectId, environment) {
    if (!commands || commands.length === 0) return null;

    const serviceHandler = SERVICE_HANDLERS[serviceType];
    if (!serviceHandler) {
        throw new Error(`Unsupported service type: ${serviceType}`);
    }

    const { handler, preparePayload } = serviceHandler;

    // Group commands that require tunnels
    let tunnelNeeded = ['redis', 'sql', 'opensearch'].includes(serviceType);
    let tunnelInfo = null;

    if (tunnelNeeded) {
        try {
            tunnelInfo = await tunnelManager.openTunnel(projectId, environment);
        } catch (error) {
            logger.error(`Failed to establish tunnel for ${serviceType}`, {
                error: error.message,
                projectId,
                environment
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
        body: preparePayload(commands, projectId, environment)
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
            environment
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
    const { projectId, environment } = req.params; executeSingleCommand
    const userId = req.session.user.id;

    try {
        const allCommands = await commandService.getAll();
        const commandsToRun = allCommands.filter(cmd => cmd.auto_run);
        const commandsByService = commandsToRun.reduce((acc, cmd) => {
            acc[cmd.service_type] = acc[cmd.service_type] || [];
            acc[cmd.service_type].push({
                ...cmd,
                command: cmd.command,
                execute_on_all_nodes: Boolean(cmd.execute_on_all_nodes)
            });
            return acc;
        }, {});

        // Send initial status to client
        WebSocketService.broadcastToUser({
            type: 'execution_started',
            timestamp: new Date().toISOString(),
            services: Object.keys(commandsByService)
        }, userId);

        // Execute services in parallel
        const servicePromises = Object.entries(commandsByService).map(
            async ([serviceType, commands]) => {
                try {
                    const serviceResults = await executeServiceCommands(
                        serviceType,
                        commands,
                        projectId,
                        environment
                    );

                    // Only send the results array in service_complete
                    WebSocketService.broadcastToUser({
                        type: 'service_complete',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        results: serviceResults.results // Just send the results array
                    }, userId);

                    return { serviceType, results: serviceResults };
                } catch (error) {
                    WebSocketService.broadcastToUser({
                        type: 'service_error',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        error: error.message
                    }, userId);

                    return {
                        serviceType,
                        error: error.message
                    };
                }
            }
        );

        // Wait for all services to complete
        const results = await Promise.all(servicePromises);

        // Only send a simple completion message without duplicating the results
        WebSocketService.broadcastToUser({
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
        }, userId);

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
            environment
        });

        const errorResponse = {
            error: 'Failed to execute commands',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        };

        WebSocketService.broadcastToUser({
            type: 'execution_error',
            timestamp: new Date().toISOString(),
            error: errorResponse
        }, userId);

        res.status(500).json(errorResponse);
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

    if (!commandId || !projectId) {
        return res.status(400).json({ error: 'Command ID and project ID are required' });
    }

    try {
        const command = await commandService.getById(commandId);
        if (!command || command.length === 0) {
            return res.status(404).json({ error: 'Command not found' });
        }

        const singleCommand = command[0];

        // Check if command should use bash service
        if (singleCommand.service_type === 'magento_cloud' && shouldUseBashService(singleCommand.command)) {
            singleCommand.service_type = 'bash';
        }

        const serviceType = singleCommand.service_type;
        const serviceHandler = SERVICE_HANDLERS[serviceType];

        if (!serviceHandler) {
            return res.status(400).json({ error: `Unsupported service type: ${serviceType}` });
        }

        const { handler, preparePayload } = serviceHandler;

        // Execute command using the appropriate handler
        const request = {
            params: {
                projectId,
                environment,
                instance
            },
            body: preparePayload([singleCommand], projectId, environment) // Pass an array with the single command
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

        // Add error handling and logging
        try {
            await handler(request, responseHandler);
        } catch (innerError) {
            logger.error(`Error executing ${serviceType} command:`, {
                error: innerError.message,
                projectId,
                environment,
                commandId
            });
            return res.status(500).json({
                error: 'Failed to execute command',
                details: process.env.NODE_ENV === 'development' ? innerError.message : undefined,
                timestamp: new Date().toISOString()
            });
        }
        console.log("Single Command=============>" + JSON.stringify(responseHandler.data, null, 2));
        if (responseHandler.statusCode && responseHandler.statusCode >= 400) {
            logger.error(`Error executing ${serviceType} command:`, {
                error: responseHandler.data.error,
                projectId,
                environment,
                commandId
            });
            return res.status(responseHandler.statusCode).json(responseHandler.data);
        }

        res.json(responseHandler.data);
    } catch (error) {
        logger.error('Failed to execute single command:', {
            error: error.message,
            projectId,
            environment,
            commandId
        });

        res.status(500).json({
            error: 'Failed to execute command',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
}