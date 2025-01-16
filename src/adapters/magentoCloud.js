// src/adapters/magentoCloud.js
import { access, constants, mkdir } from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from '../services/logger.js';
import { paths } from '../config/paths.js';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

class MagentoCloudAdapter {
    constructor() {
        this.executablePath = paths.resources.magentoCloud;
        this.baseHomeDir = path.join(os.tmpdir(), 'magento-cloud'); // Base directory for all users
    }

    /**
     * Validates that the Magento Cloud executable exists and is executable.
     */
    async validateExecutable() {
        try {
            await access(this.executablePath, constants.X_OK);
            logger.debug('Magento Cloud executable validated');
        } catch (err) {
            logger.error('Magento Cloud executable validation failed:', {
                error: err.message,
                path: this.executablePath,
                timestamp: new Date().toISOString()
            });
            throw new Error('Magento Cloud executable not found or not executable');
        }
    }

    /**
     * Generates a unique Magento Cloud home directory path based on userId.
     * @param {string} userId - The unique identifier for the user
     * @returns {string} - The path to the user's Magento Cloud home directory
     */
    generateHomeDir(userId) {
        // Sanitize userId to prevent directory traversal or injection
        const sanitizedUserId = userId.replace(/[^a-zA-Z0-9-_]/g, '');
        return path.join(this.baseHomeDir, `user-${sanitizedUserId}`);
    }

    /**
     * Ensures that the provided home directory exists.
     * @param {string} homeDir - The directory to be used as MAGENTO_CLOUD_HOME
     */
    async ensureHomeDir(homeDir) {
        try {
            await mkdir(homeDir, { recursive: true, mode: 0o700 });
            logger.debug(`Ensured Magento Cloud home directory exists: ${homeDir}`);
        } catch (err) {
            logger.error('Failed to create Magento Cloud home directory:', {
                error: err.message,
                homeDir,
                timestamp: new Date().toISOString()
            });
            throw new Error('Failed to create Magento Cloud home directory');
        }
    }

    /**
     * Executes a Magento Cloud CLI command with dynamic environment variables.
     * @param {string} command - The command to execute
     * @param {string} apiToken - The API token for authentication
     * @param {string} userId - The unique identifier for the user
     * @returns {Object} - The stdout and stderr from the command
     */
    async executeCommand(command, apiToken, userId) {
        console.log('userId in magentoCloudAdapter:executeCommand=====>', userId);
        if (!apiToken) {
            throw new Error("API token is required for Magento Cloud CLI commands.");
        }

        if (!userId) {
            throw new Error("User ID is required to generate Magento Cloud home directory.");
        }

        // Generate and ensure the home directory exists
        const homeDir = this.generateHomeDir(userId);
        await this.ensureHomeDir(homeDir);

        try {
            const { stdout, stderr } = await execAsync(`${this.executablePath} ${command}`, {
                env: {
                    ...process.env,
                    PATH: `/usr/local/bin:/usr/bin:${process.env.PATH}`, // To allow using PHP from PATH
                    MAGENTO_CLOUD_CLI_TOKEN: apiToken,
                    MAGENTO_CLOUD_HOME: homeDir
                },
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            });
            return { stdout, stderr };
        } catch (error) {
            if (command.startsWith('tunnel:info') && error.message.includes('No tunnels found')) {
                logger.info('Magento Cloud command execution (tunnel:info) returned no tunnel info (expected when tunnel is closed).', {
                    command,
                    timestamp: new Date().toISOString()
                });
                return { stdout: '', stderr: error.message };
            } else {
                logger.error('Magento Cloud command execution failed:', {
                    error: error.message,
                    command,
                    timestamp: new Date().toISOString()
                });
                throw error;
            }
        }
    }

    /**
     * Executes a Magento Cloud CLI command and streams its output.
     * @param {string} command - The command to execute
     * @param {string} apiToken - The API token for authentication
     * @param {string} userId - The unique identifier for the user
     * @returns {Object} - The child process
     */
    executeCommandStream(command, apiToken, userId) {
        console.log('userId in magentoCloudAdapter:executeCommandStream=====>', userId);
        if (!apiToken) {
            throw new Error("API token is required for Magento Cloud CLI commands.");
        }

        if (!userId) {
            throw new Error("User ID is required to generate Magento Cloud home directory.");
        }

        // Generate and ensure the home directory exists
        const homeDir = this.generateHomeDir(userId);
        this.ensureHomeDir(homeDir).catch(err => {
            logger.error('Failed to ensure Magento Cloud home directory:', {
                error: err.message,
                homeDir,
                timestamp: new Date().toISOString()
            });
            throw err;
        });

        const tunnelProcess = exec(`${this.executablePath} ${command}`, {
            env: {
                ...process.env,
                PATH: `/usr/local/bin:/usr/bin:${process.env.PATH}`, // To allow using PHP from PATH
                MAGENTO_CLOUD_CLI_TOKEN: apiToken,
                MAGENTO_CLOUD_HOME: homeDir
            },
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });

        return { tunnelProcess };
    }
}

export default MagentoCloudAdapter;
