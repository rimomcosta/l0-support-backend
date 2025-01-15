// src/services/magentoCloudService.js

import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

export class MagentoCloudService {
    constructor() {
        this.magentoCloud = new MagentoCloudAdapter();
    }

    normalizeProjectFlag(command) {
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

    escapeQuotesForShell(command) {
        return command.replace(/"/g, '\\"');
    }

    replacePlaceholders(command, context) {
        let processedCommand = this.normalizeProjectFlag(command);
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
                    const flagWithPlaceholder = new RegExp(`\\s*${flag}\\s*${placeholder}`, 'g');
                    processedCommand = processedCommand.replace(flagWithPlaceholder, '');
                });
            }
        });

        return processedCommand.trim();
    }

    async executeCommand(command, context, apiToken) {
        console.log('step 23=====> executeCommand called with:', { command, context, apiToken });
        try {
            let processedCommand = this.replacePlaceholders(command, context);
            processedCommand = this.escapeQuotesForShell(processedCommand);

            logger.debug('Executing magento-cloud command:', {
                originalCommand: command,
                processedCommand,
                context
            });

            if (!processedCommand) {
                throw new Error('Invalid command after processing placeholders');
            }

            const { stdout, stderr } = await this.magentoCloud.executeCommand(processedCommand, apiToken);

            console.log('step 24=====> Command execution result:', { stdout, stderr });

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

    async executeMultipleCommands(commands, context, apiToken) {
        console.log('step 17=====> executeMultipleCommands called with:', { commands, context, apiToken });

        // Validate that 'commands' is an array
        if (!Array.isArray(commands)) {
            logger.error('executeMultipleCommands received invalid commands type:', { commands });
            throw new Error('Commands should be an array');
        }

        console.log('step 18=====> commands is an array with length:', commands.length);

        // Validate the Magento Cloud executable
        await this.magentoCloud.validateExecutable();
        console.log('step 19=====> Magento Cloud executable validated successfully');

        // Log the commands being executed
        console.log('step 20=====> Commands to execute:', JSON.stringify(commands, null, 2));

        return Promise.all(commands.map(async (cmd, index) => {
            console.log(`step 21=====> Executing command ${index + 1}:`, cmd);

            const { output, error, status } = await this.executeCommand(
                cmd.command,
                context,
                apiToken
            );

            console.log(`step 22=====> Command ${index + 1} executed with status:`, status);

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
    }
}

export default new MagentoCloudService();
