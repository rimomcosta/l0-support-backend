// src/services/commandExecutionService.js
import { logger } from './logger.js';
import { logActivity } from './activityLogger.js';
import { tunnelManager } from './tunnelService.js';
import { WebSocketService } from './webSocketService.js';
import { UserActivityService } from './userActivityService.js';
import { CommandService } from './commandsManagerService.js';
import { CommandValidationService } from './commandValidationService.js';
import * as sshCommands from '../api/app/sshCommands.js';
import * as sqlCommands from '../api/app/sqlCommands.js';
import * as redisCommands from '../api/app/redisCommands.js';
import * as openSearchCommands from '../api/app/openSearchCommands.js';
import * as magentoCloudDirectAccess from '../api/app/magentoCloudDirectAccess.js';
import * as bashCommands from '../api/app/bashCommands.js';
import * as rabbitmqCommands from '../api/app/rabbitmqCommands.js';

export class CommandExecutionService {
    constructor() {
        this.commandService = new CommandService();
        this.validationService = new CommandValidationService();
        this.serviceHandlers = this.initializeServiceHandlers();
    }

    initializeServiceHandlers() {
        return {
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
                        command: cmd.command,
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
                            .replace(/--p\s+/g, '--project ')
                            .replace(/-project\s+/g, '-p ');

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
    }

    async executeServiceCommands(serviceType, commands, projectId, environment, userId, apiToken) {
        if (!commands || commands.length === 0) return null;

        logger.info('executeServiceCommands called', {
            serviceType,
            projectId,
            environment,
            userId,
            commandCount: commands.length,
            commandIds: commands.map(c => c.id)
        });

        const serviceHandler = this.serviceHandlers[serviceType];
        if (!serviceHandler) {
            logger.error('Unsupported service type', {
                serviceType,
                availableTypes: Object.keys(this.serviceHandlers)
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

    async executeAllCommands(projectId, environment, userId, apiToken, tabId, sessionId, userGroups, ipAddress, userAgent) {
        logger.info('executeAllCommands called', {
            projectId,
            environment,
            userId,
            tabId,
            hasApiToken: !!apiToken,
            sessionId
        });

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
        const allCommands = await this.commandService.getAll();
        
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
        let tunnelIndependentResults = [];
        
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
                    const serviceResults = await this.executeServiceCommands(
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
                            sessionId: sessionId,
                            groups: userGroups,
                            ip_address: ipAddress,
                            user_agent: userAgent
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
                    const serviceResults = await this.executeServiceCommands(
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
                            sessionId: sessionId,
                            groups: userGroups,
                            ip_address: ipAddress,
                            user_agent: userAgent
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

        return finalResults;
    }

    async refreshService(serviceType, projectId, environment, userId, apiToken, tabId) {
        if (!serviceType || !projectId || !environment) {
            throw new Error('Service type, project ID, and environment are required');
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
            const allCommands = await this.commandService.getAll();
            const serviceCommands = allCommands.filter(cmd =>
                cmd.service_type === serviceType && cmd.auto_run && cmd.reviewed
            );

            if (serviceCommands.length === 0) {
                return { results: [] };
            }

            // Execute commands for this service
            const serviceResults = await this.executeServiceCommands(
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

            return { results: serviceResults.results };

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

            throw error;
        }
    }

    async executeSingleCommand(commandId, projectId, environment, userId, apiToken, tabId) {
        logger.info('Executing single command:', {
            commandId,
            projectId,
            environment,
            userId,
            tabId,
            timestamp: new Date().toISOString()
        });

        if (!commandId || !projectId) {
            throw new Error('Command ID and project ID are required');
        }

        // Get API token for the user
        if (!apiToken) {
            throw new Error('API token not found for user');
        }

        const command = await this.commandService.getById(commandId);
        if (!command || command.length === 0) {
            throw new Error('Command not found');
        }

        const singleCommand = command[0];
        // Check if the command is reviewed
        if (!singleCommand.reviewed) {
            throw new Error('This command has not been reviewed and cannot be executed');
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
        const serviceHandler = this.serviceHandlers[serviceType];
        if (!serviceHandler) {
            throw new Error(`Unsupported service type: ${serviceType}`);
        }

        // Execute the command using executeServiceCommands
        const result = await this.executeServiceCommands(
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

            return result;
        } else {
            throw new Error('Command execution returned no results');
        }
    }
}
