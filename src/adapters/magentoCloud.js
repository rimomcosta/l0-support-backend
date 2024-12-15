// src/adapters/magentoCloud.js
import { access, constants } from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from '../services/logger.js';
import { paths } from '../config/paths.js';

const execAsync = promisify(exec);

class MagentoCloudAdapter {
    constructor() {
        this.executablePath = paths.resources.magentoCloud;
    }

    async validateExecutable() {
        try {
            await access(this.executablePath, constants.X_OK);
            logger.debug('Magento cloud executable validated');
        } catch (err) {
            logger.error('Magento cloud executable validation failed:', {
                error: err.message,
                path: this.executablePath,
                timestamp: new Date().toISOString()
            });
            throw new Error('Magento cloud executable not found or not executable');
        }
    }

    async executeCommand(command) {
        try {
            const { stdout, stderr } = await execAsync(`${this.executablePath} ${command}`, {
                env: {
                    ...process.env,
                    PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin`
                }
            });
            return { stdout, stderr }; // Return both stdout and stderr
        } catch (error) {
            if (command.startsWith('tunnel:info') && error.message.includes('No tunnels found')) {
                logger.info('Magento cloud command execution (tunnel:info) returned no tunnel info (expected when tunnel is closed).', {
                    command,
                    timestamp: new Date().toISOString()
                });
                return { stdout: '', stderr: error.message }; // Return empty stdout and the error message as stderr
            } else {
                logger.error('Magento cloud command execution failed:', {
                    error: error.message,
                    command,
                    timestamp: new Date().toISOString()
                });
                throw error;
            }
        }
    }

    executeCommandStream(command) {
        const tunnelProcess = exec(`${this.executablePath} ${command}`, {
            env: {
                ...process.env,
                PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin`
            }
        });

        return { tunnelProcess };
    }
}

export default MagentoCloudAdapter;