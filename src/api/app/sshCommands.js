// src/api/app/sshCommands.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { execute as getNodes } from './nodes.js';
import { ApiTokenService } from '../../services/apiTokenService.js';

/**
 * Instead of bundling commands into a single inline command, we will create
 * a script (as a string) and pass it to SSH via a here-document.
 */
function createScriptContent(commands) {
    // Each command prints its id and title, then runs the command line from DB.
    // We do not escape quotes here, we just trust the script content.
    return commands.map(cmd => {
        return `echo 'id: ${cmd.id}'
echo 'title: ${cmd.title}'
${cmd.command}
`;
    }).join('\n');
}

// Parses the output from commands into individual results
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

async function executeWithRetry(magentoCloud, command, apiToken, options = { maxRetries: 3, delay: 1000 }) {
    console.log('apiToken in sshCommands:executeWithRetry=====>', apiToken);
    let lastError;

    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
        try {
            const result = await magentoCloud.executeCommand(command, apiToken); // Pass apiToken
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

async function executeSSHCommandsOnNode(magentoCloud, projectId, environment, nodeId, commands, isSingleNode, apiToken) { // Add apiToken
    console.log('apiToken in sshCommands:executeSSHCommandsOnNode=====>', apiToken);
    try {
        // Create the script content with all commands.
        const scriptContent = createScriptContent(commands);

        // Use a here-document to pass the script to `bash -s` via SSH.
        // The 'EOF' delimiter is quoted to prevent shell expansion of variables inside it.
        const sshPrefix = isSingleNode
            ? `ssh -p ${projectId} -e ${environment}`
            : `ssh -p ${projectId} -e ${environment} --instance ${nodeId}`;

        const sshCommand = `${sshPrefix} "bash -s" <<'EOF'
${scriptContent}
EOF`;

        logger.debug("Executing SSH command via here-document:", {
            sshCommand,
            nodeId,
            isSingleNode
        });

        const { stdout, stderr } = await executeWithRetry(
            magentoCloud,
            sshCommand,
            apiToken, // Pass apiToken
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

function validateCommand(cmd, index) {
    const errors = [];

    // Check required fields
    if (!cmd.id) errors.push('Missing id');
    if (!cmd.title) errors.push('Missing title');
    if (!cmd.command) errors.push('Missing command');
    if (typeof cmd.executeOnAllNodes !== 'boolean') {
        errors.push('Missing or invalid executeOnAllNodes');
    }

    // Validate command string
    if (cmd.command && typeof cmd.command === 'string') {
        if (cmd.command.trim().length === 0) {
            errors.push('Empty command string');
        }
    }

    return errors;
}

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id; // Get userId
    const apiToken = req.session.decryptedApiToken;
console.log('apiToken in sshCommands:runCommands=====>', apiToken);
    logger.info('Received SSH commands:', {
        projectId,
        environment,
        userId,
        commands: commands.map(cmd => ({
            id: cmd.id,
            title: cmd.title,
            command: cmd.command
        }))
    });

    if (!Array.isArray(commands) || commands.length === 0) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be a non-empty array'
        });
    }

    // Track valid and invalid commands separately
    const validCommands = [];
    const invalidCommands = [];

    // Validate commands individually
    commands.forEach((cmd, index) => {
        const errors = validateCommand(cmd, index);

        if (errors.length > 0) {
            invalidCommands.push({
                command: cmd,
                errors,
                index
            });
        } else {
            validCommands.push(cmd);
        }
    });

    try {
        // const apiToken = await ApiTokenService.getApiToken(userId); // Get API token
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        const nodes = await getNodes(projectId, environment, apiToken); // Pass apiToken to getNodes
        const isSingleNode = !nodes || nodes.length <= 1;

        if (!nodes || nodes.length === 0) {
            throw new Error('No nodes found in the environment');
        }

        // Execute only valid commands
        const results = [];

        if (validCommands.length > 0) {
            const allNodesCommands = validCommands.filter(cmd => cmd.executeOnAllNodes);

            // Execute commands on first node
            const node1Results = await executeSSHCommandsOnNode(
                magentoCloud,
                projectId,
                environment,
                isSingleNode ? null : nodes[0].id,
                validCommands,
                isSingleNode,
                apiToken // Pass apiToken
            );

            // Initialize results for all valid commands
            validCommands.forEach(command => {
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
                        false,
                        apiToken // Pass apiToken
                    )
                );

                const remainingNodesResults = await Promise.all(remainingNodePromises);
                const flattenedResults = remainingNodesResults.flat();

                // Add results from remaining nodes
                allNodesCommands.forEach(command => {
                    const resultEntry = results.find(r => r.id === command.id);
                    if (resultEntry) {
                        resultEntry.results.push(...flattenedResults.filter(r => r.commandId === command.id));
                    }
                });
            }
        }

        // Add results for invalid commands
        invalidCommands.forEach(({ command }) => {
            results.push({
                id: command.id,
                title: command.title,
                command: command.command,
                results: [{
                    commandId: command.id,
                    nodeId: 'validation-error',
                    output: null,
                    error: 'Command failed validation',
                    status: "ERROR"
                }]
            });
        });

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
            results,
            warnings: invalidCommands.length > 0 ? {
                message: `${invalidCommands.length} command(s) were skipped due to validation errors`,
                skippedCommands: invalidCommands.map(ic => ({
                    id: ic.command.id,
                    title: ic.command.title,
                    errors: ic.errors
                }))
            } : undefined
        });

    } catch (error) {
        logger.error('Commands execution failed', {
            error: error.message,
            projectId,
            environment,
            userId,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Command execution failed',
            details: error.message,
            results: [], // Return empty results array
            timestamp: new Date().toISOString()
        });
    }
}
