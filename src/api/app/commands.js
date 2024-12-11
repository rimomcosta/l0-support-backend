import { CommandService } from '../../services/commandsManagerService.js';
import { WebSocketService } from '../../services/webSocketService.js';
import { logger } from '../../services/logger.js';
import * as sshCommands from './sshCommands.js';
import * as sqlCommands from './sqlCommands.js';
import * as redisCommands from './redisCommands.js';
import * as openSearchCommands from './openSearchCommands.js';
import * as magentoCloudDirectAccess from './magentoCloudDirectAccess.js';

const commandService = new CommandService();

class ServiceResponseHandler {
    constructor() {
        this.statusCode = 200;
        this.data = null;
    }

    status(code) {
        this.statusCode = code;
        return this;
    }

    json(data) {
        this.data = data;
        return this;
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
                command: cmd.command_config?.command || cmd.command_config,
                executeOnAllNodes: cmd.execute_on_all_nodes
            }))
        })
    },
    sql: {
        handler: sqlCommands.runQueries,
        preparePayload: (commands) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command_config?.query || cmd.command_config,
                executeOnAllNodes: cmd.execute_on_all_nodes
            }))
        })
    },
    redis: {
        handler: redisCommands.runQueries,
        preparePayload: (commands) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command_config?.command || cmd.command_config,
                executeOnAllNodes: cmd.execute_on_all_nodes
            }))
        })
    },
    opensearch: {
        handler: openSearchCommands.runQueries,
        preparePayload: (commands) => ({
            queries: commands.map(cmd => {
                const config = typeof cmd.command_config === 'string' 
                    ? JSON.parse(cmd.command_config) 
                    : cmd.command_config;
                return {
                    id: cmd.id,
                    title: cmd.title,
                    command: {
                        method: config.method || 'GET',
                        path: config.path,
                        data: config.data || null
                    }
                };
            })
        })
    },
    magento_cloud: {
        handler: magentoCloudDirectAccess.executeCommands,
        preparePayload: (commands) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command_config?.command || cmd.command_config,
                executeOnAllNodes: cmd.execute_on_all_nodes
            }))
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
    const request = {
        params: { projectId, environment },
        body: preparePayload(commands)
    };

    const responseHandler = new ServiceResponseHandler();

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

export async function executeAllCommands(req, res) {
    const { projectId, environment } = req.params;

    try {
        const allCommands = await commandService.getAll();
        
        const commandsByService = allCommands.reduce((acc, cmd) => {
            acc[cmd.service_type] = acc[cmd.service_type] || [];
            acc[cmd.service_type].push(cmd);
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

                WebSocketService.broadcast({
                    type: 'service_complete',
                    serviceType,
                    timestamp: new Date().toISOString(),
                    results: serviceResults
                });

            } catch (error) {
                results.services[serviceType] = {
                    error: error.message,
                    timestamp: new Date().toISOString()
                };

                WebSocketService.broadcast({
                    type: 'service_error',
                    serviceType,
                    timestamp: new Date().toISOString(),
                    error: error.message
                });
            }
        });

        await Promise.all(serviceExecutions);

        WebSocketService.broadcast({
            type: 'execution_complete',
            timestamp: new Date().toISOString(),
            results
        });

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

        WebSocketService.broadcast({
            type: 'execution_error',
            timestamp: new Date().toISOString(),
            error: errorResponse
        });

        res.status(500).json(errorResponse);
    }
}

// CRUD operations remain the same
export async function getCommand(req, res) {
    try {
        const command = await commandService.getById(req.params.id);
        res.json(command);
    } catch (error) {
        logger.error('Failed to get command:', error);
        res.status(500).json({ error: error.message });
    }
} // Review done

export async function getCommands(req, res) {
    try {
        const commands = await commandService.getAll();
        res.json(commands);
    } catch (error) {
        logger.error('Failed to get commands:', error);
        res.status(500).json({ error: error.message });
    }
} // Review done

export async function createCommand(req, res) {
    try {
        const id = await commandService.create(req.body);
        res.status(201).json({ id });
    } catch (error) {
        logger.error('Failed to create command:', error);
        res.status(500).json({ error: error.message });
    }
} // Review done 

export async function updateCommand(req, res) {
    try {
        await commandService.update(req.params.id, req.body);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Failed to update command:', error);
        res.status(500).json({ error: error.message });
    }
} // Review done

export async function deleteCommand(req, res) {
    try {
        console.log(req.params.id);
        await commandService.delete(req.params.id);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Failed to delete command:', error);
        res.status(500).json({ error: error.message });
    }
} // Review done