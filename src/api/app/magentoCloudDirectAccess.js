// src/api/app/magentoCloudDirectAccess.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';

/**
 * Normalizes project flags in the command.
 * @param {string} command - The original command
 * @returns {string} - The normalized command
 */
function normalizeProjectFlag(command) {
    const parts = command.split('|');
    const magentoCommand = parts[0];
    
    let normalized = magentoCommand
        .replace(/\s+--p\s+/, ' --project ')
        .replace(/\s+-project\s+/, ' -p ');
    
    if (parts.length > 1) {
        normalized += ' | ' + parts.slice(1).join(' | ');
    }
    
    return normalized;
}

/**
 * Escapes quotes in the command for shell execution.
 * @param {string} command - The command to escape
 * @returns {string} - The escaped command
 */
function escapeQuotesForShell(command) {
    return command.replace(/"/g, '\\"');
}

/**
 * Replaces placeholders in the command with actual values.
 * @param {string} command - The command with placeholders
 * @param {Object} context - The context containing actual values
 * @returns {string} - The processed command
 */
function replacePlaceholders(command, context) {
    let processedCommand = normalizeProjectFlag(command);
    processedCommand = processedCommand.replace(/^magento-cloud\s+/, '');

    const placeholders = {
        ':projectid': {
            value: context.projectId,
            flags: ['-p', '--project']
        },
        ':environment': {
            value: context.environment,
            flags: ['-e', '--environment']
        },
        ':instanceid': {
            value: context.instance,
            flags: ['--instance']
        }
    };

    Object.entries(placeholders).forEach(([placeholder, config]) => {
        if (config.value) {
            processedCommand = processedCommand.replace(
                new RegExp(placeholder, 'g'),
                config.value
            );
        } else {
            // Remove the placeholder and its associated flag if the value is missing
            config.flags.forEach(flag => {
                const flagWithPlaceholder = new RegExp(`\\s*${flag}\\s*${placeholder}`, 'g');
                processedCommand = processedCommand.replace(flagWithPlaceholder, '');
            });
        }
    });

    return processedCommand.trim();
}

/**
 * Executes a single Magento Cloud CLI command.
 * @param {MagentoCloudAdapter} magentoCloud - The MagentoCloudAdapter instance
 * @param {string} command - The command to execute
 * @param {Object} context - The context containing projectId, environment, and instance
 * @param {string} apiToken - The API token for authentication
 * @param {string} userId - The unique identifier for the user
 * @returns {Object} - The result of the command execution
 */
export async function executeCommand(magentoCloud, command, context, apiToken, userId) {
    logger.debug('Executing Magento Cloud command:', { command, context, userId });
    try {
        let processedCommand = replacePlaceholders(command, context);
        processedCommand = escapeQuotesForShell(processedCommand);

        if (!processedCommand) {
            throw new Error('Invalid command after processing placeholders');
        }

        const { stdout, stderr } = await magentoCloud.executeCommand(processedCommand, apiToken, userId);

        return {
            output: stdout || null,
            error: stderr || null,
            status: stderr ? 'ERROR' : 'SUCCESS'
        };
    } catch (error) {
        logger.error('Command execution failed:', {
            error: error.message,
            command,
            context
        });

        return {
            output: null,
            error: error.message,
            status: 'ERROR'
        };
    }
}

/**
 * Handles the execution of multiple Magento Cloud CLI commands.
 * @param {Object} req - The Express request object
 * @param {Object} res - The Express response object
 */
export async function executeCommands(req, res) {
    const { projectId, environment, instance } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id; // Get user ID
    const apiToken = req.session.decryptedApiToken;
    console.log('apiToken in magentoCloudDirectAccess:executeCommands=====>', apiToken);
    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    try { 
        if (!apiToken) {
            return res.status(401).json({ error: 'API token not found for user' });
        }

        // Use the adapter
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        const context = { 
            projectId, 
            environment: environment || null,
            instance: instance || null
        };

        const results = await Promise.all(commands.map(async (cmd) => {
            const { output, error, status } = await executeCommand(
                magentoCloud, 
                cmd.command,
                context,
                apiToken, // Pass apiToken to executeCommand
                userId    // Pass userId to executeCommand
            );
            
            return {
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                results: [{
                    nodeId: 'single-node',
                    output,
                    error,
                    status
                }],
                summary: {
                    total: 1,
                    successful: status === 'SUCCESS' ? 1 : 0,
                    failed: status === 'ERROR' ? 1 : 0
                }
            };
        }));

        res.json({
            projectId,
            environment,
            instance: instance || undefined,
            timestamp: new Date().toISOString(),
            results
        });
    } catch (error) {
        logger.error('Commands execution failed:', {
            error: error.message,
            projectId,
            environment,
            instance,
            userId
        });

        res.status(500).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Handles the execution of SSH commands.
 * @param {Object} req - The Express request object
 * @param {Object} res - The Express response object
 */
export async function executeSSHCommand(req, res) {
    const { projectId, environment } = req.params;
    const { command } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken;

    if (!command) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Command must be provided'
        });
    }

    if (!apiToken) {
        return res.status(401).json({ error: 'API token not found for user' });
    }

    try {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        const context = { 
            projectId, 
            environment: environment || null,
            instance: null // SSH might not need instance
        };

        // Process and sanitize the command
        let processedCommand = replacePlaceholders(command, context);
        processedCommand = escapeQuotesForShell(processedCommand);

        if (!processedCommand) {
            throw new Error('Invalid command after processing placeholders');
        }

        // Execute the SSH command as a stream
        const { tunnelProcess } = magentoCloud.executeCommandStream(processedCommand, apiToken, userId);
        logger.debug('Executing Magento Cloud command for userId:magentoCloudDirectAccess:executeCommandStream',userId);
        // Set headers for streaming
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');

        // Stream stdout to the client
        tunnelProcess.stdout.on('data', (data) => {
            res.write(data);
        });

        // Stream stderr to the client
        tunnelProcess.stderr.on('data', (data) => {
            res.write(data);
        });

        // Handle process exit
        tunnelProcess.on('close', (code) => {
            res.end(`\nProcess exited with code ${code}`);
        });

        // Handle errors
        tunnelProcess.on('error', (err) => {
            logger.error('SSH process error:', { error: err.message, userId });
            res.status(500).end('SSH process encountered an error.');
        });

    } catch (error) {
        logger.error('SSH command execution failed:', {
            error: error.message,
            projectId,
            environment,
            userId
        });

        res.status(500).json({
            error: 'SSH command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
