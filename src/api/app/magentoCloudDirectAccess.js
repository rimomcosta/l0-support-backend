// src/api/app/magentoCloudDirectAccess.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { ApiTokenService } from '../../services/apiTokenService.js';

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

function escapeQuotesForShell(command) {
    return command.replace(/"/g, '\\"');
}

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

export async function executeCommand(magentoCloud, command, context, apiToken) {
    try {
        let processedCommand = replacePlaceholders(command, context);
        processedCommand = escapeQuotesForShell(processedCommand);

        logger.debug('Executing magento-cloud command:', {
            originalCommand: command,
            processedCommand,
            context
        });

        if (!processedCommand) {
            throw new Error('Invalid command after processing placeholders');
        }

        const { stdout, stderr } = await magentoCloud.executeCommand(processedCommand, apiToken);

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

export async function executeCommands(req, res) {
    const { projectId, environment, instance } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id; // Get user ID

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    try {
        const apiToken = await ApiTokenService.getApiToken(userId); // Get API token
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
                apiToken // Pass apiToken to executeCommand
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
