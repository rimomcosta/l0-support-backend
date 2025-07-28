// src/adapters/magentoCloud.js
import { access, constants, mkdir } from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger, magentoLogger, logMagentoOperation } from '../services/logger.js';
import { paths } from '../config/paths.js';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

class MagentoCloudAdapter {
    constructor() {
        this.executablePath = paths.resources.magentoCloud;
        this.baseHomeDir = path.join(os.tmpdir(), 'magento-cloud'); // Base directory for all users
        
        logMagentoOperation('info', 'MagentoCloudAdapter initialized', {
            executablePath: this.executablePath,
            baseHomeDir: this.baseHomeDir,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Validates that the Magento Cloud executable exists and is executable.
     */
    async validateExecutable() {
        try {
            await access(this.executablePath, constants.X_OK);
            logMagentoOperation('debug', 'Magento Cloud executable validated successfully', {
                executablePath: this.executablePath,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            logMagentoOperation('error', 'Magento Cloud executable validation failed', {
                error: err.message,
                errorCode: err.code,
                executablePath: this.executablePath,
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
        const homeDir = path.join(this.baseHomeDir, `user-${sanitizedUserId}`);
        
        logMagentoOperation('debug', 'Generated Magento Cloud home directory', {
            userId: sanitizedUserId,
            homeDir: homeDir,
            timestamp: new Date().toISOString()
        });
        
        return homeDir;
    }

    /**
     * Ensures that the provided home directory exists.
     * @param {string} homeDir - The directory to be used as MAGENTO_CLOUD_HOME
     */
    async ensureHomeDir(homeDir) {
        try {
            await mkdir(homeDir, { recursive: true, mode: 0o700 });
            logMagentoOperation('debug', 'Ensured Magento Cloud home directory exists', {
                homeDir: homeDir,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            logMagentoOperation('error', 'Failed to create Magento Cloud home directory', {
                error: err.message,
                errorCode: err.code,
                homeDir: homeDir,
                timestamp: new Date().toISOString()
            });
            throw new Error('Failed to create Magento Cloud home directory');
        }
    }

    /**
     * Executes a Magento Cloud CLI command with modified environment variables.
     * @param {string} command - The command to execute
     * @param {string} apiToken - The API token for authentication
     * @param {string} userId - The unique identifier for the user
     * @returns {Object} - The stdout and stderr from the command
     */
    async executeCommand(command, apiToken, userId) {
        if (!apiToken) {
            logMagentoOperation('error', 'API token is required for Magento Cloud CLI commands', {
                userId: userId,
                command: command,
                timestamp: new Date().toISOString()
            });
            throw new Error("API token is required for Magento Cloud CLI commands.");
        }

        if (!userId) {
            logMagentoOperation('error', 'User ID is required to generate Magento Cloud home directory', {
                command: command,
                hasApiToken: !!apiToken,
                timestamp: new Date().toISOString()
            });
            throw new Error("User ID is required to generate Magento Cloud home directory.");
        }

        // Extract command details for logging
        const commandParts = command.split(' ');
        const commandType = commandParts[0];
        const projectId = command.match(/-p\s+(\S+)/)?.[1] || 'unknown';
        const environment = command.match(/-e\s+(\S+)/)?.[1] || 'unknown';

        // Log command execution start
        logMagentoOperation('info', 'Executing Magento Cloud command', {
            command: command,
            commandType: commandType,
            projectId: projectId,
            environment: environment,
            userId: userId,
            hasApiToken: !!apiToken,
            timestamp: new Date().toISOString()
        });

        // Generate and ensure the home directory exists
        const homeDir = this.generateHomeDir(userId);
        await this.ensureHomeDir(homeDir);

        // Destructure to exclude unwanted environment variables
        const { MAGENTO_CLOUD_APPLICATION_NAME, MAGENTO_CLOUD_BRANCH, ...cleanEnv } = process.env;

        const envVars = {
            ...cleanEnv,
            PATH: `/usr/local/bin:/usr/bin:${cleanEnv.PATH}`, // To allow using PHP from PATH
            MAGENTO_CLOUD_CLI_TOKEN: apiToken,
            MAGENTO_CLOUD_HOME: homeDir
        };

        logMagentoOperation('debug', 'Command environment prepared', {
            commandType: commandType,
            projectId: projectId,
            environment: environment,
            homeDir: homeDir,
            hasPath: !!envVars.PATH,
            hasToken: !!envVars.MAGENTO_CLOUD_CLI_TOKEN,
            timestamp: new Date().toISOString()
        });

        try {
            const { stdout, stderr } = await execAsync(`${this.executablePath} ${command}`, {
                env: envVars,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });

            logMagentoOperation('debug', 'Command executed successfully', {
                commandType: commandType,
                projectId: projectId,
                environment: environment,
                hasOutput: Boolean(stdout),
                hasError: Boolean(stderr),
                outputLength: stdout ? stdout.length : 0,
                errorLength: stderr ? stderr.length : 0,
                timestamp: new Date().toISOString()
            });

            return { stdout, stderr };
        } catch (error) {
            // Check for authentication errors in stderr
            const stderr = error.stderr || '';
            const stdout = error.stdout || '';
            const combinedOutput = stderr + stdout;
            
            // Common authentication error patterns
            const authErrorPatterns = [
                'Invalid API token',
                'authentication',
                'unauthorized',
                '401',
                'Access denied',
                'Permission denied',
                'API token has been revoked',
                'API token is invalid',
                'Authentication required'
            ];
            
            const isAuthError = authErrorPatterns.some(pattern => 
                combinedOutput.toLowerCase().includes(pattern.toLowerCase())
            );
            
            if (isAuthError) {
                logMagentoOperation('error', 'Authentication error detected', {
                    commandType: commandType,
                    projectId: projectId,
                    environment: environment,
                    userId: userId,
                    errorMessage: error.message,
                    stderr: stderr.substring(0, 500), // Log first 500 chars of stderr
                    stdout: stdout.substring(0, 500), // Log first 500 chars of stdout
                    timestamp: new Date().toISOString()
                });
                
                // Create a more informative error for authentication issues
                const authError = new Error('Authentication failed: Invalid or revoked API token');
                authError.code = 'AUTH_FAILED';
                authError.stderr = stderr;
                authError.stdout = stdout;
                throw authError;
            }
            
            if (command.startsWith('tunnel:info') && error.message.includes('No tunnels found')) {
                logMagentoOperation('info', 'Magento Cloud command execution (tunnel:info) returned no tunnel info (expected when tunnel is closed)', {
                    command: command,
                    commandType: commandType,
                    projectId: projectId,
                    environment: environment,
                    timestamp: new Date().toISOString()
                });
                return { stdout: '', stderr: error.message };
            } else {
                logMagentoOperation('error', 'Magento Cloud command execution failed', {
                    commandType: commandType,
                    projectId: projectId,
                    environment: environment,
                    userId: userId,
                    errorMessage: error.message,
                    errorCode: error.code,
                    stderr: stderr.substring(0, 1000), // Log first 1000 chars of stderr
                    stdout: stdout.substring(0, 1000), // Log first 1000 chars of stdout
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
        if (!apiToken) {
            logMagentoOperation('error', 'API token is required for Magento Cloud CLI commands', {
                userId: userId,
                command: command,
                timestamp: new Date().toISOString()
            });
            throw new Error("API token is required for Magento Cloud CLI commands.");
        }

        if (!userId) {
            logMagentoOperation('error', 'User ID is required to generate Magento Cloud home directory', {
                command: command,
                hasApiToken: !!apiToken,
                timestamp: new Date().toISOString()
            });
            throw new Error("User ID is required to generate Magento Cloud home directory.");
        }

        // Generate and ensure the home directory exists
        const homeDir = this.generateHomeDir(userId);
        this.ensureHomeDir(homeDir).catch(err => {
            logMagentoOperation('error', 'Failed to ensure Magento Cloud home directory', {
                error: err.message,
                homeDir: homeDir,
                timestamp: new Date().toISOString()
            });
            throw err;
        });

        // Destructure to exclude unwanted environment variables
        const { MAGENTO_CLOUD_APPLICATION_NAME, MAGENTO_CLOUD_BRANCH, ...cleanEnv } = process.env;

        const tunnelProcess = exec(`${this.executablePath} ${command}`, {
            env: {
                ...cleanEnv,
                PATH: `/usr/local/bin:/usr/bin:${cleanEnv.PATH}`, // To allow using PHP from PATH
                MAGENTO_CLOUD_CLI_TOKEN: apiToken,
                MAGENTO_CLOUD_HOME: homeDir
            },
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });
        // Log output to console for debugging
        tunnelProcess.stdout.on('data', (data) => {
            logMagentoOperation('debug', 'Stream output received', {
                dataLength: data.toString().length,
                timestamp: new Date().toISOString()
            });
        });

        tunnelProcess.stderr.on('data', (data) => {
            logMagentoOperation('debug', 'Stream error output received', {
                dataLength: data.toString().length,
                timestamp: new Date().toISOString()
            });
        });

        tunnelProcess.on('close', (code) => {
            logMagentoOperation('debug', 'Stream process closed', {
                code: code,
                timestamp: new Date().toISOString()
            });
        });
        return { tunnelProcess };
    }
}

export default MagentoCloudAdapter;
