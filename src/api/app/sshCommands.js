import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { execute as getNodes } from './nodes.js';

// Executes an SSH command with retry mechanism
async function executeWithRetry(magentoCloud, command, options = { maxRetries: 3, delay: 1000 }) {
    let lastError;

    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
        try {
            const result = await magentoCloud.executeCommand(command);
            if (attempt > 1) {
                logger.info('Command succeeded after retry', {
                    attempt,
                    command,
                    timestamp: new Date().toISOString()
                });
            }
            return result;
        } catch (error) {
            lastError = error;

            // Check if it's an authentication error
            const isAuthError = error.message.includes('SSH certificate authentication is required') ||
                error.message.includes('Access denied') ||
                error.message.includes('authentication failures');

            if (!isAuthError) {
                // If it's not an auth error, don't retry
                throw error;
            }

            if (attempt < options.maxRetries) {
                logger.warn('Retrying SSH command due to authentication failure', {
                    attempt,
                    command,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });

                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
        }
    }

    // If we get here, all retries failed
    logger.error('SSH command failed after all retry attempts', {
        maxRetries: options.maxRetries,
        command,
        error: lastError.message,
        timestamp: new Date().toISOString()
    });

    throw lastError;
}

async function executeSSHCommandsOnNode(magentoCloud, projectId, environment, nodeId, commands) {
    try {
        // Execute each command separately to maintain clear separation
        const results = await Promise.all(commands.map(async (cmd) => {
            try {
                const escapedCommand = cmd.command.replace(/"/g, '\\"');
                const { stdout, stderr } = await executeWithRetry(
                    magentoCloud,
                    `ssh -p ${projectId} -e ${environment} --instance ${nodeId} "${escapedCommand}"`,
                    { maxRetries: 3, delay: 1000 }
                );

                return {
                    commandId: cmd.id,
                    nodeId,
                    output: (stdout + stderr).trim(),
                    error: null
                };
            } catch (error) {
                return {
                    commandId: cmd.id,
                    nodeId,
                    output: null,
                    error: error.message
                };
            }
        }));

        return results;
    } catch (error) {
        logger.error('Command execution failed', {
            nodeId,
            error: error.message,
            timestamp: new Date().toISOString()
        });

        return commands.map(cmd => ({
            commandId: cmd.id,
            nodeId,
            output: null,
            error: error.message
        }));
    }
}

// Executes commands across multiple nodes in parallel.
async function executeCommandsAcrossNodes(magentoCloud, projectId, environment, commands, nodeIds) {
    // Create a promise for each node's execution
    const executionPromises = nodeIds.map(nodeId =>
        executeSSHCommandsOnNode(magentoCloud, projectId, environment, nodeId, commands)
            .catch(error => {
                logger.error(`Failed to execute commands on node ${nodeId}`, {
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                return commands.map(cmd => ({
                    commandId: cmd.id,
                    nodeId,
                    output: null,
                    error: error.message
                }));
            })
    );

    // Wait for all executions to complete and flatten the results
    const results = await Promise.all(executionPromises);
    return results.flat();
}

// Main API handler for executing SSH commands.
export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    try {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        // Get nodes
        const nodes = await getNodes(projectId, environment);
        if (!nodes || nodes.length === 0) {
            throw new Error('No nodes found in the environment');
        }

        const nodeIds = nodes.map(node => node.id);

        // Process each command according to its execution strategy
        const results = await Promise.all(commands.map(async (command) => {
            const commandResult = {
                id: command.id,
                title: command.title,
                command: command.command,
                results: []
            };

            if (command.executeOnAllNodes) {
                // Execute on all nodes
                const nodeResults = await Promise.all(nodeIds.map(nodeId =>
                    executeSSHCommandsOnNode(magentoCloud, projectId, environment, nodeId, [command])
                ));
                commandResult.results = nodeResults.flat();
            } else {
                // Execute only on first node
                const singleNodeResult = await executeSSHCommandsOnNode(
                    magentoCloud, 
                    projectId, 
                    environment, 
                    nodeIds[0], 
                    [command]
                );
                commandResult.results = singleNodeResult;
            }

            return commandResult;
        }));

        res.json({
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            results
        });

    } catch (error) {
        logger.error('Commands execution failed', {
            error: error.message,
            projectId,
            environment,
            timestamp: new Date().toISOString()
        });

        const statusCode = error.message.includes('authentication')
            ? 401
            : error.message.includes('No nodes found')
                ? 404
                : 500;

        res.status(statusCode).json({
            error: 'Command execution failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}