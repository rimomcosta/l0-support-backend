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

// Service type handlers configuration
const SERVICE_HANDLERS = {
    ssh: {
        handler: sshCommands.runCommands,
        preparePayload: (commands) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                // command: cmd.command.replace(/^"|"$/g, ''),
                executeOnAllNodes: Boolean(cmd.execute_on_all_nodes)
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
                // query: cmd.command.replace(/^"|"$/g, ''),
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
                // query: cmd.command.replace(/^"|"$/g, '')
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
                // let command = cmd.command.replace(/^"|"$/g, '');
                let command = cmd.command;
                // Replace placeholders in the command during payload preparation
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

    logger.info(`Executing ${serviceType} commands:`, {
        count: commands.length,
        commands: commands.map(cmd => ({
            id: cmd.id,
            title: cmd.title,

        }))
    });

    const { handler, preparePayload } = serviceHandler;

    // Group commands that require tunnels
    let tunnelNeeded = ['redis', 'sql', 'opensearch'].includes(serviceType);
    let tunnelInfo = null;

    if (tunnelNeeded) {
        try {
            tunnelInfo = await tunnelManager.openTunnel(projectId, environment);
            logger.debug(`Tunnel established for ${serviceType}`, {
                projectId,
                environment
            });
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
            tunnelInfo // Pass tunnel info to service handlers
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

// Execute all commands
export async function executeAllCommands(req, res) {
    const { projectId, environment } = req.params;

    try {
        const allCommands = await commandService.getAll();
        logger.info('Fetched commands from DB: ', {
            total: allCommands.length,
            commands: allCommands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                service_type: cmd.service_type
            }))
        });

        // Filter commands where auto_run is true
        const commandsToRun = allCommands.filter(cmd => cmd.auto_run);

        const commandsByService = commandsToRun.reduce((acc, cmd) => {
            const serviceType = cmd.service_type;
            acc[serviceType] = acc[serviceType] || [];
            acc[serviceType].push({
                ...cmd,
                command: cmd.command,
                execute_on_all_nodes: Boolean(cmd.execute_on_all_nodes)
            });
            return acc;
        }, {});

        const results = {
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            services: {}
        };

        const serviceExecutions = Object.entries(commandsByService).map(async ([serviceType, commands]) => {
            try {
                const serviceResults = await executeServiceCommands(
                    serviceType,
                    commands,
                    projectId,
                    environment
                );

                results.services[serviceType] = serviceResults;

                // Update this to use broadcastToUser instead of broadcast
                WebSocketService.broadcastToUser({
                    type: 'service_complete',
                    serviceType,
                    timestamp: new Date().toISOString(),
                    results: serviceResults
                }, req.session.user.id);  // Pass the user ID

            } catch (error) {
                results.services[serviceType] = {
                    error: error.message,
                    timestamp: new Date().toISOString()
                };

                // Update this to use broadcastToUser
                WebSocketService.broadcastToUser({
                    type: 'service_error',
                    serviceType,
                    timestamp: new Date().toISOString(),
                    error: error.message
                }, req.session.user.id);  // Pass the user ID
            }
        });

        await Promise.all(serviceExecutions);

        // Update final broadcast
        WebSocketService.broadcastToUser({
            type: 'execution_complete',
            timestamp: new Date().toISOString(),
            results
        }, req.session.user.id);  // Pass the user ID

        res.json(results);

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
        }, req.session.user.id);

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
    const instance = req.body.instance || null; // Not used yet

    if (!commandId || !projectId) {
        return res.status(400).json({ error: 'Command ID, project ID and environment are required' });
    }

    try {
        const command = await commandService.getById(commandId);
        if (!command || command.length === 0) {
            return res.status(404).json({ error: 'Command not found' });
        }

        const singleCommand = command[0];
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