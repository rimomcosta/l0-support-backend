// src/services/magentoCloudDirectAccessService.js
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

export class MagentoCloudDirectAccessService {
    /**
     * Normalizes project flags in the command.
     * @param {string} command - The original command
     * @returns {string} - The normalized command
     */
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

    /**
     * Escapes quotes in the command for shell execution.
     * @param {string} command - The command to escape
     * @returns {string} - The escaped command
     */
    escapeQuotesForShell(command) {
        // Don't escape quotes for commands with pipes, as it breaks the shell interpretation
        if (command.includes('|')) {
            return command;
        }
        return command.replace(/"/g, '\\"');
    }

    /**
     * Replaces placeholders in the command with actual values.
     * @param {string} command - The command with placeholders
     * @param {Object} context - The context containing actual values
     * @returns {string} - The processed command
     */
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
    async executeCommand(magentoCloud, command, context, apiToken, userId) {
        logger.debug('Executing Magento Cloud command:', { command, context, userId });
        try {
            let processedCommand = this.replacePlaceholders(command, context);
            processedCommand = this.escapeQuotesForShell(processedCommand);

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
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} instance - Instance ID
     * @param {Array} commands - Array of commands
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with command results
     */
    async executeCommands(projectId, environment, instance, commands, apiToken, userId) {
        try {
            // Use the adapter
            const magentoCloud = new MagentoCloudAdapter();
            await magentoCloud.validateExecutable();

            const context = {
                projectId,
                environment: environment || null,
                instance: instance || null
            };

            const results = await Promise.all(commands.map(async (cmd) => {
                const { output, error, status } = await this.executeCommand(
                    magentoCloud,
                    cmd.command,
                    context,
                    apiToken,
                    userId
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
                    allowAi: cmd.allowAi,
                    summary: {
                        total: 1,
                        successful: status === 'SUCCESS' ? 1 : 0,
                        failed: status === 'ERROR' ? 1 : 0
                    }
                };
            }));

            return {
                success: true,
                projectId,
                environment,
                instance: instance || undefined,
                timestamp: new Date().toISOString(),
                results,
                statusCode: 200
            };
        } catch (error) {
            logger.error('Commands execution failed:', {
                error: error.message,
                projectId,
                environment,
                instance,
                userId
            });

            return {
                success: false,
                error: 'Command execution failed',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                statusCode: 500
            };
        }
    }

    /**
     * Handles the execution of SSH commands with streaming.
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} command - Command to execute
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Result object with tunnel process
     */
    async executeSSHCommand(projectId, environment, command, apiToken, userId) {
        try {
            const magentoCloud = new MagentoCloudAdapter();
            await magentoCloud.validateExecutable();

            const context = {
                projectId,
                environment: environment || null,
                instance: null // SSH might not need instance
            };

            // Process and sanitize the command
            let processedCommand = this.replacePlaceholders(command, context);
            processedCommand = this.escapeQuotesForShell(processedCommand);

            if (!processedCommand) {
                throw new Error('Invalid command after processing placeholders');
            }

            // Execute the SSH command as a stream
            const { tunnelProcess } = magentoCloud.executeCommandStream(processedCommand, apiToken, userId);
            logger.debug('Executing Magento Cloud command for userId:magentoCloudDirectAccess:executeCommandStream', userId);

            return {
                success: true,
                tunnelProcess,
                statusCode: 200
            };
        } catch (error) {
            logger.error('SSH command execution failed:', {
                error: error.message,
                projectId,
                environment,
                userId
            });

            return {
                success: false,
                error: 'SSH command execution failed',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                statusCode: 500
            };
        }
    }
}
