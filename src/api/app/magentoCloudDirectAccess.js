// src/api/app/magentoCloudDirectAccess.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

export async function executeCommand(magentoCloud, command, context) {
    try {
        let processedCommand = replacePlaceholders(command, context);

        // Escape double quotes in the entire command
        processedCommand = escapeQuotesForShell(processedCommand);

        logger.debug('Executing magento-cloud command:', {
            originalCommand: command,
            processedCommand,
            context
        });

        if (!processedCommand) {
            throw new Error('Invalid command after processing placeholders');
        }

        processedCommand = processedCommand.replace(/^magento-cloud\s+/, '');

        const { stdout, stderr } = await execAsync(`magento-cloud ${processedCommand}`, {
            maxBuffer: 1024 * 1024 * 10,
        });
        
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
            const { output, error, status } = await executeCommand(
                magentoCloud, 
                cmd.command.replace(/^"|"$/g, ''),
                context
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
            instance
        });

        res.status(500).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}