// src/api/app/sshCommands.js
import { logger, sshLogger, logSSHOperation } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { execute as getNodes } from './nodes.js';
import { ApiTokenService } from '../../services/apiTokenService.js';

/**
 * Instead of bundling commands into a single inline command, we will create
 * a script (as a string) and pass it to SSH via a here-document.
 */
function createScriptContent(commands) {
    // Each command is wrapped in unique start/end markers, and its exit code is checked.
    return commands.map(cmd => {
        const startMarker = `ACCS_CMD_START_${cmd.id}_${Date.now()}`;
        const endMarker = `ACCS_CMD_END_${cmd.id}`;
        const errorMarker = `ACCS_CMD_ERROR_${cmd.id}`;

        // Trim the command to prevent syntax errors from trailing whitespace.
        const trimmedCommand = cmd.command.trim();

        // Wrap the command to capture its exit code.
        // If the command fails (non-zero exit code), we echo a unique error marker.
        return `echo "${startMarker}";
${trimmedCommand};
if [ $? -ne 0 ]; then echo "${errorMarker}"; fi;
echo "${endMarker}";
`;
    }).join('\n');
}

// Parses the output from commands into individual results
function parseCommandOutput(output, commands) {
    const results = [];

    commands.forEach(cmd => {
        const startMarker = `ACCS_CMD_START_${cmd.id}`;
        const endMarker = `ACCS_CMD_END_${cmd.id}`;
        const errorMarker = `ACCS_CMD_ERROR_${cmd.id}`;

        // Regex to find the content between the unique start and end markers for this command.
        const regex = new RegExp(`${startMarker}_\\d+([\\s\\S]*?)${endMarker}`, 'g');
        let match;
        let foundMatch = false;

        while ((match = regex.exec(output)) !== null) {
            foundMatch = true;
            // The full output for this command, including our error marker if it exists.
            const commandOutputWithMeta = match[1];

            // Check if our unique error marker is present.
            const hasError = commandOutputWithMeta.includes(errorMarker);

            // Clean the error marker from the final output that the user sees.
            const finalOutput = commandOutputWithMeta.replace(errorMarker, '').trim();

            results.push({
                commandId: cmd.id,
                output: finalOutput,
                error: hasError ? 'Command executed with a non-zero exit code.' : null,
                status: hasError ? "ERROR" : "SUCCESS"
            });
        }

        // If a command's markers were not found in the output at all, it's an error.
        if (!foundMatch) {
            results.push({
                commandId: cmd.id,
                output: null,
                error: `Command output not found. Delimiter markers were not present in the final output.`,
                status: "ERROR"
            });
        }
    });

    return results;
}

async function executeWithRetry(magentoCloud, command, apiToken, userId, options = { maxRetries: 3, delay: 1000 }) {
    let lastError;

    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
        try {
            logSSHOperation('debug', `Attempting SSH command execution (attempt ${attempt}/${options.maxRetries})`, {
                command: command,
                attempt: attempt,
                maxRetries: options.maxRetries,
                userId: userId,
                timestamp: new Date().toISOString()
            });

            const result = await magentoCloud.executeCommand(command, apiToken, userId);
            
            if (attempt > 1) {
                logSSHOperation('info', 'SSH command succeeded after retry', {
                    command: command,
                    attempt: attempt,
                    userId: userId,
                    timestamp: new Date().toISOString()
                });
            } else {
                logSSHOperation('debug', 'SSH command executed successfully on first attempt', {
                    command: command,
                    userId: userId,
                    timestamp: new Date().toISOString()
                });
            }
            
            return result;
        } catch (error) {
            lastError = error;
            const isAuthError = error.message.includes('SSH certificate authentication is required') ||
                error.message.includes('Access denied') ||
                error.message.includes('authentication failures');

            logSSHOperation('warn', `SSH command execution failed (attempt ${attempt}/${options.maxRetries})`, {
                command: command,
                attempt: attempt,
                maxRetries: options.maxRetries,
                userId: userId,
                errorMessage: error.message,
                errorCode: error.code,
                isAuthError: isAuthError,
                stderr: error.stderr ? error.stderr.substring(0, 500) : null,
                stdout: error.stdout ? error.stdout.substring(0, 500) : null,
                timestamp: new Date().toISOString()
            });

            if (!isAuthError) throw error;

            if (attempt < options.maxRetries) {
                logSSHOperation('info', `Retrying SSH command in ${options.delay}ms due to authentication error`, {
                    command: command,
                    attempt: attempt,
                    nextAttempt: attempt + 1,
                    delay: options.delay,
                    userId: userId,
                    timestamp: new Date().toISOString()
                });
                
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
        }
    }

    logSSHOperation('error', 'SSH command failed after all retry attempts', {
        command: command,
        maxRetries: options.maxRetries,
        userId: userId,
        finalError: lastError.message,
        timestamp: new Date().toISOString()
    });

    throw lastError;
}

async function executeSSHCommandsOnNode(magentoCloud, projectId, environment, nodeId, commands, isSingleNode, apiToken, userId) {
    try {
        logSSHOperation('info', 'Starting SSH command execution on node', {
            projectId: projectId,
            environment: environment,
            nodeId: isSingleNode ? 'single-node' : nodeId,
            isSingleNode: isSingleNode,
            commandCount: commands.length,
            commands: commands.map(cmd => ({ id: cmd.id, title: cmd.title })),
            userId: userId,
            timestamp: new Date().toISOString()
        });

        // Create the script content with all commands.
        const scriptContent = createScriptContent(commands);

        // Use a here-document to pass the script to `bash -s` via SSH.
        // The 'MAGENTO_SCRIPT' delimiter is quoted to prevent shell expansion of variables inside it.
        const sshPrefix = isSingleNode
            ? `ssh -p ${projectId} -e ${environment}`
            : `ssh -p ${projectId} -e ${environment} --instance ${nodeId}`;

        const sshCommand = `${sshPrefix} "bash -s" <<'MAGENTO_SCRIPT'
${scriptContent}
MAGENTO_SCRIPT`;

        logSSHOperation('debug', 'Prepared SSH command with here-document', {
            projectId: projectId,
            environment: environment,
            nodeId: isSingleNode ? 'single-node' : nodeId,
            sshPrefix: sshPrefix,
            scriptLength: scriptContent.length,
            commandCount: commands.length,
            userId: userId,
            timestamp: new Date().toISOString()
        });

        const { stdout, stderr } = await executeWithRetry(
            magentoCloud,
            sshCommand,
            apiToken,
            userId,
            { maxRetries: 3, delay: 1000 }
        );

        const output = stdout + stderr;
        
        logSSHOperation('debug', 'SSH command execution completed', {
            projectId: projectId,
            environment: environment,
            nodeId: isSingleNode ? 'single-node' : nodeId,
            outputLength: output.length,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
            userId: userId,
            timestamp: new Date().toISOString()
        });
        
        // Debug logging for cron command (ID 22)
        const hasCronCommand = commands.some(cmd => cmd.id === 22);
        if (hasCronCommand) {
            logSSHOperation('info', 'Cron command raw output (first 500 chars)', {
                projectId: projectId,
                environment: environment,
                nodeId: isSingleNode ? 'single-node' : nodeId,
                outputLength: output.length,
                outputSample: output.substring(0, 500),
                userId: userId,
                timestamp: new Date().toISOString()
            });
        }
        
        const results = parseCommandOutput(output, commands).map(result => ({
            ...result,
            nodeId: isSingleNode ? 'single-node' : nodeId
        }));

        // Log parsing results
        const successCount = results.filter(r => r.status === 'SUCCESS').length;
        const errorCount = results.filter(r => r.status === 'ERROR').length;
        
        logSSHOperation('info', 'SSH command parsing completed', {
            projectId: projectId,
            environment: environment,
            nodeId: isSingleNode ? 'single-node' : nodeId,
            totalCommands: commands.length,
            successCount: successCount,
            errorCount: errorCount,
            userId: userId,
            timestamp: new Date().toISOString()
        });

        return results;
    } catch (error) {
        logSSHOperation('error', 'SSH command execution failed on node', {
            projectId: projectId,
            environment: environment,
            nodeId: isSingleNode ? 'single-node' : nodeId,
            errorMessage: error.message,
            errorCode: error.code,
            userId: userId,
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

    logSSHOperation('info', 'Received SSH commands request', {
        projectId: projectId,
        environment: environment,
        userId: userId,
        commandCount: commands.length,
        commands: commands.map(cmd => ({
            id: cmd.id,
            title: cmd.title,
            command: cmd.command,
            allowAi: cmd.allowAi,
            executeOnAllNodes: cmd.executeOnAllNodes
        })),
        hasApiToken: !!apiToken,
        timestamp: new Date().toISOString()
    });

    if (!Array.isArray(commands) || commands.length === 0) {
        logSSHOperation('error', 'Invalid commands array provided', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            commands: commands,
            timestamp: new Date().toISOString()
        });
        
        return res.status(400).json({
            error: 'Commands array is required and must not be empty'
        });
    }

    // Validate each command
    const validationErrors = [];
    commands.forEach((cmd, index) => {
        const errors = validateCommand(cmd, index);
        if (errors.length > 0) {
            validationErrors.push({
                index,
                commandId: cmd.id,
                errors
            });
        }
    });

    if (validationErrors.length > 0) {
        logSSHOperation('error', 'Command validation failed', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            validationErrors: validationErrors,
            timestamp: new Date().toISOString()
        });
        
        return res.status(400).json({
            error: 'Command validation failed',
            details: validationErrors
        });
    }

    try {
        logSSHOperation('info', 'Starting SSH command execution process', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            commandCount: commands.length,
            timestamp: new Date().toISOString()
        });

        // Get nodes for the project/environment
        const nodes = await getNodes(req, res);
        
        if (!nodes || nodes.length === 0) {
            logSSHOperation('error', 'No nodes found for project/environment', {
                projectId: projectId,
                environment: environment,
                userId: userId,
                timestamp: new Date().toISOString()
            });
            
            return res.status(404).json({
                error: 'No nodes found for the specified project and environment'
            });
        }

        logSSHOperation('debug', 'Retrieved nodes for SSH execution', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            nodeCount: nodes.length,
            nodes: nodes.map(node => ({ id: node.id, name: node.name })),
            timestamp: new Date().toISOString()
        });

        const magentoCloud = new MagentoCloudAdapter();
        const results = [];

        // Execute commands on each node
        for (const node of nodes) {
            logSSHOperation('debug', `Executing commands on node: ${node.name}`, {
                projectId: projectId,
                environment: environment,
                userId: userId,
                nodeId: node.id,
                nodeName: node.name,
                commandCount: commands.length,
                timestamp: new Date().toISOString()
            });

            const nodeResults = await executeSSHCommandsOnNode(
                magentoCloud,
                projectId,
                environment,
                node.id,
                commands,
                false, // isSingleNode
                apiToken,
                userId
            );

            results.push(...nodeResults);
        }

        // Calculate overall statistics
        const totalCommands = results.length;
        const successfulCommands = results.filter(r => r.status === 'SUCCESS').length;
        const failedCommands = results.filter(r => r.status === 'ERROR').length;

        logSSHOperation('info', 'SSH command execution completed', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            totalCommands: totalCommands,
            successfulCommands: successfulCommands,
            failedCommands: failedCommands,
            successRate: totalCommands > 0 ? (successfulCommands / totalCommands * 100).toFixed(2) + '%' : '0%',
            timestamp: new Date().toISOString()
        });

        res.json({
            results,
            summary: {
                totalCommands,
                successfulCommands,
                failedCommands,
                successRate: totalCommands > 0 ? (successfulCommands / totalCommands * 100).toFixed(2) + '%' : '0%'
            }
        });

    } catch (error) {
        logSSHOperation('error', 'SSH command execution process failed', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: 'Failed to execute SSH commands',
            message: error.message
        });
    }
}
