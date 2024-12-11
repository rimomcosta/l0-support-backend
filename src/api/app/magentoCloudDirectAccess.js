// src/api/app/magentoCloudDirectAccess.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';

function normalizeProjectFlag(command) {
    // Replace --p with proper --project
    command = command.replace(/\s+--p\s+/, ' --project ');
    // Replace -project with proper -p
    command = command.replace(/\s+-project\s+/, ' -p ');
    return command;
}

function replacePlaceholders(command, context) {
    // First normalize any project flags
    let processedCommand = normalizeProjectFlag(command);
    
    // Remove any 'magento-cloud' prefix if it exists
    processedCommand = processedCommand.replace(/^magento-cloud\s+/, '');
    
    // Create a map of placeholders and their values
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

    // Process each placeholder
    Object.entries(placeholders).forEach(([placeholder, config]) => {
        if (config.value) {
            // Replace the placeholder itself
            processedCommand = processedCommand.replace(
                new RegExp(placeholder, 'g'), 
                config.value
            );
        } else {
            // If no value provided, remove the flag and placeholder
            config.flags.forEach(flag => {
                processedCommand = processedCommand.replace(
                    new RegExp(`\\s+${flag}\\s+${placeholder}`, 'g'),
                    ''
                );
            });
        }
    });

    return processedCommand.trim();
}

async function executeCommand(magentoCloud, command, context) {
    try {
        const processedCommand = replacePlaceholders(command, context);

        logger.debug('Executing magento-cloud command:', {
            originalCommand: command,
            processedCommand,
            context
        });

        if (!processedCommand) {
            throw new Error('Invalid command after processing placeholders');
        }

        const { stdout, stderr } = await magentoCloud.executeCommand(processedCommand);

        return {
            output: stdout || null,
            error: stderr || null
        };
    } catch (error) {
        logger.error('Command execution failed:', {
            error: error.message,
            command,
            context
        });

        return {
            output: null,
            error: error.message
        };
    }
}

export async function executeCommands(req, res) {
    const { projectId, environment, instance } = req.params;
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

        const context = { 
            projectId, 
            environment: environment || null,
            instance: instance || null
        };

        const results = await Promise.all(commands.map(async (cmd) => {
            const { output, error } = await executeCommand(
                magentoCloud, 
                cmd.command.replace(/^"|"$/g, ''), // Remove surrounding quotes if present
                context
            );
            
            return {
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                results: [{
                    output,
                    error
                }]
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
            instance
        });

        res.status(500).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}