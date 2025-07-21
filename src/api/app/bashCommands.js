// src/api/app/bashCommands.js
import { logger } from '../../services/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { paths } from '../../config/paths.js';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

/**
 * Generates a unique Magento Cloud home directory path based on userId.
 * Similar to MagentoCloudAdapter.generateHomeDir but standalone for bash service.
 * @param {string} userId - The unique identifier for the user
 * @returns {string} - The path to the user's Magento Cloud home directory
 */
function generateUserHomeDir(userId) {
    // Sanitize userId to prevent directory traversal or injection
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9-_]/g, '');
    const baseHomeDir = path.join(os.tmpdir(), 'magento-cloud');
    return path.join(baseHomeDir, `user-${sanitizedUserId}`);
}

/**
 * Replaces placeholders in bash commands with actual values.
 * Simplified version compared to magento-cloud service since bash doesn't need flag normalization.
 * @param {string} command - The command with placeholders
 * @param {Object} context - The context containing actual values
 * @returns {string} - The processed command
 */
function replacePlaceholders(command, context) {
    const placeholders = {
        ':projectid': context.projectId || '',
        ':environment': context.environment || '',
        ':instanceid': context.instance || ''
    };

    let processedCommand = command;
    Object.entries(placeholders).forEach(([placeholder, value]) => {
        if (value) {
            processedCommand = processedCommand.replace(
                new RegExp(placeholder, 'g'),
                value
            );
        } else {
            // Remove placeholder if no value available
            processedCommand = processedCommand.replace(
                new RegExp(placeholder, 'g'),
                ''
            );
        }
    });

    return processedCommand.trim();
}

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken; // Get apiToken from session

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    if (!apiToken) {
        return res.status(401).json({ error: 'API token not found for user' });
    }

    const results = [];
    const context = {
        projectId,
        environment,
        instance: null // bash service doesn't typically use instance
    };

    try {
        for (const cmd of commands) {
            try {
                const userHomeDir = generateUserHomeDir(userId);
                
                // Replace placeholders in the command
                const processedCommand = replacePlaceholders(cmd.command, context);
                
                // Log placeholder replacement for debugging
                if (cmd.command !== processedCommand) {
                    logger.debug('Bash command placeholder replacement', {
                        userId,
                        originalCommand: cmd.command,
                        processedCommand,
                        projectId,
                        environment
                    });
                }

                const { stdout, stderr } = await execAsync(processedCommand, {
                    maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                    env: {
                        ...process.env, // Inherit existing environment variables
                        MAGENTO_CLOUD_CLI_TOKEN: apiToken,
                        MAGENTO_CLOUD_HOME: userHomeDir,
                        // Add magento-cloud resources directory to PATH
                        PATH: `${path.dirname(paths.resources.magentoCloud)}:${process.env.PATH}`
                    }
                });

                results.push({
                    id: cmd.id,
                    title: cmd.title,
                    command: cmd.command, // Store original command
                    allowAi: cmd.allowAi,
                    results: [{
                        nodeId: 'bash',
                        output: stdout || null,
                        error: stderr || null,
                        status: stderr ? 'ERROR' : 'SUCCESS'
                    }],
                    summary: {
                        total: 1,
                        successful: stderr ? 0 : 1,
                        failed: stderr ? 1 : 0
                    }
                });
            } catch (cmdError) {
                logger.error('Bash command execution failed', {
                    userId,
                    commandId: cmd.id,
                    commandTitle: cmd.title,
                    error: cmdError.message,
                    projectId,
                    environment
                });

                results.push({
                    id: cmd.id,
                    title: cmd.title,
                    command: cmd.command,
                    allowAi: cmd.allowAi,
                    results: [{
                        nodeId: 'bash',
                        output: null,
                        error: cmdError.message,
                        status: 'ERROR'
                    }],
                    summary: {
                        total: 1,
                        successful: 0,
                        failed: 1
                    }
                });
            }
        }

        res.json({
            timestamp: new Date().toISOString(),
            results
        });

    } catch (error) {
        logger.error('Bash commands execution failed:', {
            error: error.message,
            projectId,
            environment,
            userId
        });
        res.status(500).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
}