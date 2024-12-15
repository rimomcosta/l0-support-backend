// src/api/app/sshCommands.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { execute as getNodes } from './nodes.js';

// Bundles multiple commands into a single shell script
function bundleCommands(commands) {
    return commands.map(cmd => {
        const escapedCommand = cmd.command.replace(/"/g, '\\"').replace(/'/g, "\\'");
        return `echo 'id: ${cmd.id}'; echo 'title: ${cmd.title}'; ${escapedCommand};`;
    }).join(' ');
}

// Parses the output from bundled commands into individual results
function parseCommandOutput(output, commands) {
    const results = [];
    const lines = output.split('\n');
    let currentCommand = null;
    let currentOutput = [];

    for (let line of lines) {
        if (line.startsWith('id: ')) {
            // Save previous command's output if exists
            if (currentCommand) {
                results.push({
                    commandId: currentCommand.id,
                    output: currentOutput.join('\n').trim(),
                    error: null,
                    status: currentOutput.join('\n').trim() ? "SUCCESS" : "ERROR"
                });
                currentOutput = [];
            }
            // Start new command
            const id = parseInt(line.substring(4));
            currentCommand = commands.find(cmd => cmd.id === id);
            continue;
        }
        if (line.startsWith('title: ')) {
            continue;
        }
        if (currentCommand) {
            currentOutput.push(line);
        }
    }

    // Don't forget the last command
    if (currentCommand) {
        results.push({
            commandId: currentCommand.id,
            output: currentOutput.join('\n').trim(),
            error: null,
            status: currentOutput.join('\n').trim() ? "SUCCESS" : "ERROR"
        });
    }

    return results;
}

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
            const isAuthError = error.message.includes('SSH certificate authentication is required') ||
                error.message.includes('Access denied') ||
                error.message.includes('authentication failures');

            if (!isAuthError) throw error;

            if (attempt < options.maxRetries) {
                logger.warn('Retrying SSH command due to authentication failure', {
                    attempt,
                    command,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
        }
    }

    logger.error('SSH command failed after all retry attempts', {
        maxRetries: options.maxRetries,
        command,
        error: lastError.message,
        timestamp: new Date().toISOString()
    });

    throw lastError;
}

async function executeSSHCommandsOnNode(magentoCloud, projectId, environment, nodeId, commands, isSingleNode) {
    try {
        const bundledCommand = bundleCommands(commands);
        const sshCommand = isSingleNode
            ? `ssh -p ${projectId} -e ${environment} "${bundledCommand}"`
            : `ssh -p ${projectId} -e ${environment} --instance ${nodeId} "${bundledCommand}"`;

        const { stdout, stderr } = await executeWithRetry(
            magentoCloud,
            sshCommand,
            { maxRetries: 3, delay: 1000 }
        );

        const output = stdout + stderr;
        const results = parseCommandOutput(output, commands).map(result => ({
            ...result,
            nodeId: isSingleNode ? 'single-node' : nodeId
        }));

        return results;
    } catch (error) {
        logger.error('Command execution failed', {
            nodeId: isSingleNode ? 'single-node' : nodeId,
            error: error.message,
            timestamp: new Date().toISOString()
        });

        return commands.map(cmd => ({
            commandId: cmd.id,
            nodeId: isSingleNode ? 'single-node' : nodeId,
            output: null,
            error: error.message,
            status: "ERROR"
        }));
    }
}

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;

    if (!Array.isArray(commands) || commands.length === 0) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be a non-empty array'
        });
    }

    // Validate command structure and uniqueness of IDs
    const seenIds = new Set();
    const validationErrors = [];

    commands.forEach((cmd, index) => {
        // Check required fields
        if (!cmd.id) validationErrors.push(`Command at index ${index} is missing 'id'`);
        if (!cmd.title) validationErrors.push(`Command at index ${index} is missing 'title'`);
        if (!cmd.command) validationErrors.push(`Command at index ${index} is missing 'command'`);
        if (typeof cmd.executeOnAllNodes !== 'boolean') {
            validationErrors.push(`Command at index ${index} is missing 'executeOnAllNodes' or it's not a boolean`);
        }

        // Check for duplicate IDs
        if (cmd.id) {
            if (seenIds.has(cmd.id)) {
                validationErrors.push(`Duplicate command ID found: ${cmd.id}`);
            } else {
                seenIds.add(cmd.id);
            }
        }

        // Validate command string is not empty and doesn't contain dangerous characters
        if (cmd.command && typeof cmd.command === 'string') {
            if (cmd.command.trim().length === 0) {
                validationErrors.push(`Command at index ${index} has empty command string`);
            }
            // Check for command injection attempts
            if (cmd.command.includes('&&') || cmd.command.includes('||') ||
                cmd.command.includes(';') || cmd.command.includes('|')) {
                validationErrors.push(`Command at index ${index} contains invalid characters`);
            }
        }
    });

    if (validationErrors.length > 0) {
        return res.status(400).json({
            error: 'Invalid command format',
            details: validationErrors
        });
    }

    try {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        const nodes = await getNodes(projectId, environment);
        const isSingleNode = !nodes || nodes.length <= 1;

        if (!nodes || nodes.length === 0) {
            throw new Error('No nodes found in the environment');
        }

        // Prepare commands for each node
        const results = [];
        const allNodesCommands = commands.filter(cmd => cmd.executeOnAllNodes);

        // For node 1 (or single-node), execute all commands (both single-node and all-nodes commands)
        const node1Results = await executeSSHCommandsOnNode(
            magentoCloud,
            projectId,
            environment,
            isSingleNode ? null : nodes[0].id,
            commands,  // Execute all commands on node 1 or single-node
            isSingleNode
        );

        // Initialize results for all commands
        commands.forEach(command => {
            results.push({
                id: command.id,
                title: command.title,
                command: command.command,
                results: node1Results.filter(r => r.commandId === command.id)
            });
        });

        // For remaining nodes, only execute commands that should run on all nodes
        if (!isSingleNode && allNodesCommands.length > 0 && nodes.length > 1) {
            const remainingNodePromises = nodes.slice(1).map(node =>
                executeSSHCommandsOnNode(
                    magentoCloud,
                    projectId,
                    environment,
                    node.id,
                    allNodesCommands,
                    false
                )
            );

            const remainingNodesResults = await Promise.all(remainingNodePromises);
            const flattenedResults = remainingNodesResults.flat();

            // Add results from remaining nodes to the appropriate commands
            allNodesCommands.forEach(command => {
                const resultEntry = results.find(r => r.id === command.id);
                if (resultEntry) {
                    resultEntry.results.push(...flattenedResults.filter(r => r.commandId === command.id));
                }
            });
        }
        
        // Add summary for each command
        results.forEach(commandResult => {
            const successful = commandResult.results.filter(r => r.status === 'SUCCESS').length;
            const failed = commandResult.results.filter(r => r.status === 'ERROR').length;
            commandResult.summary = {
                total: commandResult.results.length,
                successful,
                failed
            };
        });

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