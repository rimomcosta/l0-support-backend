// src/api/app/commands.js
'use strict';

import { CommandService } from '../../services/commandsManagerService.js';
import { WebSocketService } from '../../services/webSocketService.js';
import { UserActivityService } from '../../services/userActivityService.js';
import { logger } from '../../services/logger.js';
import { logActivity } from '../../services/activityLogger.js';
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
        preparePayload: (commands, projectId, environment, apiToken, userId) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                allowAi: Boolean(cmd.allow_ai),
                executeOnAllNodes: Boolean(cmd.execute_on_all_nodes),
                apiToken: apiToken,
                userId: userId
            }))
        })
    },
    rabbitmq: {
        handler: rabbitmqCommands.runCommands,
        preparePayload: (commands, projectId, environment, apiToken, userId) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command, // Use "command" for RabbitMQ
                allowAi: Boolean(cmd.allow_ai),
                apiToken: apiToken,
                userId: userId
            }))
        })
    },
    bash: {
        handler: bashCommands.runCommands,
        preparePayload: (commands, projectId, environment, apiToken, userId) => ({
            commands: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                allowAi: Boolean(cmd.allow_ai),
                apiToken: apiToken,
                userId: userId
            }))
        })
    },
    sql: {
        handler: sqlCommands.runQueries,
        preparePayload: (commands, projectId, environment, apiToken, tunnelInfo, userId) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command,
                allowAi: Boolean(cmd.allow_ai),
                executeOnAllNodes: Boolean(cmd.execute_on_all_nodes),
                apiToken: apiToken,
                tunnelInfo: tunnelInfo,
                userId: userId
            }))
        })
    },
    redis: {
        handler: redisCommands.runQueries,
        preparePayload: (commands, projectId, environment, apiToken, tunnelInfo, userId) => ({
            queries: commands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                query: cmd.command,
                allowAi: Boolean(cmd.allow_ai),
                apiToken: apiToken,
                tunnelInfo: tunnelInfo,
                userId: userId
            }))
        })
    },
    opensearch: {
        handler: openSearchCommands.runQueries,
        preparePayload: (commands, projectId, environment, apiToken, tunnelInfo, userId) => ({
            queries: commands.map(cmd => {
                const config = typeof cmd.command === 'string'
                    ? JSON.parse(cmd.command)
                    : cmd.command;
                return {
                    id: cmd.id,
                    title: cmd.title,
                    command: config,
                    allowAi: Boolean(cmd.allow_ai),
                    apiToken: apiToken,
                    tunnelInfo: tunnelInfo,
                    userId: userId
                };
            })
        })
    },
    magento_cloud: {
        handler: magentoCloudDirectAccess.executeCommands,
        preparePayload: (commands, projectId, environment, apiToken, userId) => ({
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
                    allowAi: Boolean(cmd.allow_ai),
                    apiToken: apiToken,
                    userId: userId
                };
            })
        })
    }
};

async function executeServiceCommands(serviceType, commands, projectId, environment, userId, apiToken) {
    
    if (!commands || commands.length === 0) return null;

    logger.info('executeServiceCommands called', {
        serviceType,
        projectId,
        environment,
        userId,
        commandCount: commands.length,
        commandIds: commands.map(c => c.id)
    });

    const serviceHandler = SERVICE_HANDLERS[serviceType];
    if (!serviceHandler) {
        logger.error('Unsupported service type', {
            serviceType,
            availableTypes: Object.keys(SERVICE_HANDLERS)
        });
        throw new Error(`Unsupported service type: ${serviceType}`);
    }

    const { handler, preparePayload } = serviceHandler;

    // Determine if the service requires a tunnel
    let tunnelNeeded = ['redis', 'sql', 'opensearch'].includes(serviceType);
    let tunnelInfo = null;

    logger.debug('Tunnel check', {
        serviceType,
        tunnelNeeded,
        projectId,
        environment
    });

    if (tunnelNeeded) {
        try {
            logger.info('Establishing tunnel for service', {
                serviceType,
                projectId,
                environment,
                userId
            });
            
            tunnelInfo = await tunnelManager.openTunnel(projectId, environment, apiToken, userId, serviceType);
            if (!tunnelInfo) {
                logger.error('Tunnel info is null after opening', {
                    serviceType,
                    projectId,
                    environment
                });
                throw new Error('Tunnel information is unavailable after opening.');
            }
            
            logger.info('Tunnel established successfully', {
                serviceType,
                projectId,
                environment,
                services: Object.keys(tunnelInfo)
            });
        } catch (error) {
            logger.error(`Failed to establish tunnel for ${serviceType}`, {
                error: error.message,
                errorStack: error.stack,
                projectId,
                environment,
                userId
            });
            throw error;
        }
    }

    // Prepare the payload with appropriate arguments
    let payload;
    if (tunnelNeeded) {
        payload = preparePayload(commands, projectId, environment, apiToken, tunnelInfo, userId);
    } else {
        payload = preparePayload(commands, projectId, environment, apiToken, userId);
    }

    logger.debug(`Executing commands for userId: ${userId}`, {
        serviceType,
        projectId,
        environment
    });

    const request = {
        params: {
            projectId,
            environment
        },
        body: payload,
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
        
        // Log successful command execution
        const userEmail = 'system'; // We don't have email in this context
        commands.forEach(cmd => {
            logActivity.command.executed(userId, userEmail, serviceType, projectId, environment, cmd.id);
        });
        
        return responseHandler.data;
    } catch (error) {
        logger.error(`Error executing ${serviceType} commands:`, {
            error: error.message,
            errorStack: error.stack,
            projectId,
            environment,
            userId
        });
        
        // Log failed command execution
        const userEmail = 'system';
        logActivity.command.failed(userId, userEmail, serviceType, projectId, environment, error);
        
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
        
        // Add detailed logging for debugging
        logger.info('executeAllCommands called', {
            projectId,
            environment,
            userId,
            tabId,
            hasApiToken: !!apiToken,
            sessionId: req.sessionID
        });
        
        if (!apiToken) {
            logger.error('No decrypted API token found', {
                projectId,
                environment,
                userId,
                sessionId: req.sessionID
            });
            return res.status(401).json({ error: 'Decrypted API token not found in session' });
        }

        // Send initial status to client using tabId, including tunnel setup
        try {
            WebSocketService.broadcastToTab({
                type: 'execution_started',
                timestamp: new Date().toISOString(),
                services: ['tunnel'] // Indicate that tunnel setup is starting
            }, tabId);
        } catch (wsError) {
            logger.error('Failed to send WebSocket message', {
                error: wsError.message,
                projectId,
                environment,
                tabId
            });
            // Continue execution even if WebSocket fails
        }

        // Check if any service needs a tunnel
        const allCommands = await commandService.getAll();
        
        logger.info('Commands fetched from database', {
            projectId,
            environment,
            totalCommands: allCommands.length,
            commandTypes: allCommands.map(cmd => ({
                id: cmd.id,
                title: cmd.title,
                service_type: cmd.service_type,
                auto_run: cmd.auto_run,
                reviewed: cmd.reviewed
            }))
        });
        
        const commandsToRun = allCommands.filter(cmd => cmd.auto_run && cmd.reviewed);
        
        logger.info('Commands filtered for execution', {
            projectId,
            environment,
            commandsToRunCount: commandsToRun.length,
            commandsToRunIds: commandsToRun.map(cmd => cmd.id)
        });
        
        const commandsByService = commandsToRun.reduce((acc, cmd) => {
            acc[cmd.service_type] = acc[cmd.service_type] || [];
            acc[cmd.service_type].push(cmd);
            return acc;
        }, {});

        // Separate services by tunnel requirements
        const tunnelDependentServices = ['redis', 'sql', 'opensearch'];
        const tunnelIndependentServices = Object.keys(commandsByService).filter(serviceType => 
            !tunnelDependentServices.includes(serviceType)
        );
        const servicesNeedingTunnel = Object.keys(commandsByService).filter(serviceType => 
            tunnelDependentServices.includes(serviceType)
        );

        logger.info('Services separated by tunnel requirements', {
            projectId,
            environment,
            tunnelIndependentServices,
            servicesNeedingTunnel,
            totalServices: Object.keys(commandsByService).length
        });

        let tunnelInfo = null;
        let tunnelIndependentResults = []; // Declare at function level
        
        // Execute tunnel-independent services immediately (SSH, Bash, RabbitMQ, etc.)
        if (tunnelIndependentServices.length > 0) {
            logger.info('Executing tunnel-independent services immediately', {
                projectId,
                environment,
                services: tunnelIndependentServices
            });

            // Execute tunnel-independent services in parallel without waiting for tunnel
            const tunnelIndependentPromises = tunnelIndependentServices.map(async (serviceType) => {
                try {
                    const commands = commandsByService[serviceType];
                    const serviceResults = await executeServiceCommands(
                        serviceType,
                        commands,
                        projectId,
                        environment,
                        userId,
                        apiToken
                    );

                    // Track command execution activity
                    try {
                        const userSession = {
                            id: userId,
                            sessionId: req.sessionID,
                            groups: req.session.user.groups,
                            ip_address: req.ip,
                            user_agent: req.get('User-Agent')
                        };

                        for (const command of commands) {
                            await UserActivityService.trackCommandExecution(userSession, {
                                command_id: command.id,
                                command_name: command.title,
                                command_type: serviceType,
                                project_id: projectId,
                                environment: environment,
                                output: serviceResults.results?.[command.id]?.output || null,
                                execution_time: serviceResults.results?.[command.id]?.executionTime || 0
                            });
                        }
                    } catch (trackingError) {
                        logger.error('Failed to track command execution activity:', trackingError);
                    }

                    WebSocketService.broadcastToTab({
                        type: 'service_complete',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        results: serviceResults.results
                    }, tabId);

                    return { serviceType, results: serviceResults };
                } catch (error) {
                    logger.error(`Failed to execute tunnel-independent service ${serviceType}`, {
                        error: error.message,
                        projectId,
                        environment,
                        serviceType
                    });

                    WebSocketService.broadcastToTab({
                        type: 'service_error',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        error: error.message,
                        shouldRetry: false
                    }, tabId);

                    return { serviceType, error: error.message };
                }
            });

            // Start executing tunnel-independent services immediately
            tunnelIndependentResults = await Promise.allSettled(tunnelIndependentPromises);
            logger.info('Tunnel-independent services completed', {
                projectId,
                environment,
                results: tunnelIndependentResults.map((result, index) => ({
                    serviceType: tunnelIndependentServices[index],
                    status: result.status,
                    hasError: result.status === 'rejected' || (result.value && result.value.error)
                }))
            });
        }

        // Only establish tunnel if we have services that need it
        if (servicesNeedingTunnel.length > 0) {
            try {
                logger.info('Establishing tunnel for dependent services', {
                    projectId,
                    environment,
                    services: servicesNeedingTunnel
                });

                // Use the first service that needs a tunnel
                const firstTunnelService = servicesNeedingTunnel[0];

                // Open tunnel with progress updates
                tunnelInfo = await tunnelManager.openTunnel(projectId, environment, apiToken, userId, firstTunnelService, (status) => {
                    WebSocketService.broadcastToTab({
                        type: 'tunnel_status',
                        status,
                        timestamp: new Date().toISOString()
                    }, tabId);
                });

                if (!tunnelInfo) {
                    throw new Error('Tunnel information is unavailable after opening.');
                }

                // Indicate that tunnel setup is complete
                WebSocketService.broadcastToTab({
                    type: 'service_complete',
                    serviceType: 'tunnel',
                    timestamp: new Date().toISOString()
                }, tabId);

            } catch (error) {
                logger.error('Failed to establish tunnel for dependent services', {
                    error: error.message,
                    projectId,
                    environment,
                    userId
                });

                // Create a more user-friendly tunnel error message
                let tunnelErrorMessage = error.message;
                if (error.message.includes('tunnel failed health check') || error.message.includes('New tunnel failed health check')) {
                    tunnelErrorMessage = 'Tunnel connection failed. This is a temporary issue with the cloud environment. Please try again.';
                } else if (error.message.includes('timeout')) {
                    tunnelErrorMessage = 'Tunnel connection timed out. Please try again.';
                }

                WebSocketService.broadcastToTab({
                    type: 'service_error',
                    serviceType: 'tunnel',
                    timestamp: new Date().toISOString(),
                    error: tunnelErrorMessage,
                    shouldRetry: true
                }, tabId);

                throw error;
            }
        }

        // Send the actual list of services to be executed
        WebSocketService.broadcastToTab({
            type: 'execution_progress',
            timestamp: new Date().toISOString(),
            services: Object.keys(commandsByService)
        }, tabId);

        // Execute tunnel-dependent services (only if tunnel was established successfully)
        let tunnelDependentResults = [];
        if (servicesNeedingTunnel.length > 0 && tunnelInfo) {
            logger.info('Executing tunnel-dependent services', {
                projectId,
                environment,
                services: servicesNeedingTunnel
            });

            const tunnelDependentPromises = servicesNeedingTunnel.map(async (serviceType) => {
                try {
                    const commands = commandsByService[serviceType];
                    const serviceResults = await executeServiceCommands(
                        serviceType,
                        commands,
                        projectId,
                        environment,
                        userId,
                        apiToken
                    );

                    // Track command execution activity
                    try {
                        const userSession = {
                            id: userId,
                            sessionId: req.sessionID,
                            groups: req.session.user.groups,
                            ip_address: req.ip,
                            user_agent: req.get('User-Agent')
                        };

                        for (const command of commands) {
                            await UserActivityService.trackCommandExecution(userSession, {
                                command_id: command.id,
                                command_name: command.title,
                                command_type: serviceType,
                                project_id: projectId,
                                environment: environment,
                                output: serviceResults.results?.[command.id]?.output || null,
                                execution_time: serviceResults.results?.[command.id]?.executionTime || 0
                            });
                        }
                    } catch (trackingError) {
                        logger.error('Failed to track command execution activity:', trackingError);
                    }

                    WebSocketService.broadcastToTab({
                        type: 'service_complete',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        results: serviceResults.results
                    }, tabId);

                    return { serviceType, results: serviceResults };
                } catch (error) {
                    // Create a more user-friendly service error message
                    let serviceErrorMessage = error.message;
                    let shouldRetry = false;
                    
                    if (error.message.includes('tunnel failed health check') || error.message.includes('New tunnel failed health check')) {
                        serviceErrorMessage = 'Tunnel connection failed. This is a temporary issue with the cloud environment.';
                        shouldRetry = true;
                    } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
                        serviceErrorMessage = 'Service request timed out. Please try again.';
                        shouldRetry = true;
                    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('connection refused')) {
                        serviceErrorMessage = 'Service connection refused. Please try again.';
                        shouldRetry = true;
                    } else if (error.message.includes('authentication') || error.message.includes('unauthorized')) {
                        serviceErrorMessage = 'Service authentication failed. Please check your credentials.';
                        shouldRetry = false;
                    }
                    
                    WebSocketService.broadcastToTab({
                        type: 'service_error',
                        serviceType,
                        timestamp: new Date().toISOString(),
                        error: serviceErrorMessage,
                        shouldRetry: shouldRetry
                    }, tabId);

                    return {
                        serviceType,
                        error: serviceErrorMessage,
                        shouldRetry: shouldRetry
                    };
                }
            });

            tunnelDependentResults = await Promise.allSettled(tunnelDependentPromises);
            logger.info('Tunnel-dependent services completed', {
                projectId,
                environment,
                results: tunnelDependentResults.map((result, index) => ({
                    serviceType: servicesNeedingTunnel[index],
                    status: result.status,
                    hasError: result.status === 'rejected' || (result.value && result.value.error)
                }))
            });
        }

        // Combine results from both execution phases
        const allResults = [];
        
        // Add tunnel-independent results
        if (tunnelIndependentServices.length > 0) {
            allResults.push(...tunnelIndependentResults.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    return {
                        serviceType: tunnelIndependentServices[index],
                        error: result.reason.message,
                        shouldRetry: false
                    };
                }
            }));
        }
        
        // Add tunnel-dependent results
        if (tunnelDependentResults.length > 0) {
            allResults.push(...tunnelDependentResults.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    return {
                        serviceType: servicesNeedingTunnel[index],
                        error: result.reason.message,
                        shouldRetry: true
                    };
                }
            }));
        }

        const results = allResults;

        WebSocketService.broadcastToTab({
            type: 'execution_complete',
            timestamp: new Date().toISOString(),
            projectId,
            environment,
            summary: results.reduce((acc, result) => {
                acc[result.serviceType] = {
                    status: result.error ? 'error' : 'success',
                    error: result.error,
                    shouldRetry: result.shouldRetry || false
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
                    shouldRetry: result.shouldRetry || false,
                    timestamp: new Date().toISOString()
                };
                return acc;
            }, {})
        };
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
    // Check if the session is expired
    if (req.session && req.session.cookie && req.session.cookie._expires) {
        const now = new Date();
        const expires = new Date(req.session.cookie._expires);

        if (now > expires) {
        } else {
        }
    } else {
    }

    if (!serviceType || !projectId || !environment) {
        return res.status(400).json({ error: 'Service type, project ID, and environment are required' });
    }

    try {
        // Ensure tunnel is open before refreshing a service
        if (['redis', 'sql', 'opensearch'].includes(serviceType)) {
            try {
                const tunnelInfo = await tunnelManager.openTunnel(projectId, environment, apiToken, userId, serviceType);
                if (!tunnelInfo) {
                    throw new Error('Tunnel information is unavailable after opening.');
                }
            } catch (error) {
                logger.error(`Failed to establish tunnel for ${serviceType} refresh`, {
                    error: error.message,
                    projectId,
                    environment,
                    userId
                });
                throw error;
            }
        }

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
    const instance = req.body.instance || null;
    const userId = req.session?.user?.id;
    const tabId = req.query.tabId || req.body.tabId;
    const apiToken = req.session.decryptedApiToken;
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

        // Ensure tunnel is open before executing a single command if needed
        if (['redis', 'sql', 'opensearch'].includes(serviceType)) {
            try {
                const tunnelInfo = await tunnelManager.openTunnel(projectId, environment, apiToken, userId, serviceType);
                if (!tunnelInfo) {
                    throw new Error('Tunnel information is unavailable after opening.');
                }
            } catch (error) {
                logger.error(`Failed to establish tunnel for ${serviceType} command execution`, {
                    error: error.message,
                    projectId,
                    environment,
                    userId
                });
                throw error;
            }
        }

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