import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

const execAsync = promisify(exec);
const TUNNEL_READY_TIMEOUT = 30000; // 30 seconds timeout

class TunnelManager {
    constructor() {
        this.timers = new Map();
        this.idleTimeout = 60000;
        this.activeTunnels = new Map();
        this.magentoCloud = new MagentoCloudAdapter();
    }

    async waitForTunnelOpen(projectId, environment) {
        return new Promise((resolve, reject) => {
            const command = `tunnel:open -p ${projectId} -e ${environment} -y`;
            const { tunnelProcess } = this.magentoCloud.executeCommandStream(command);
            let output = '';
            let isReady = false;

            const timeout = setTimeout(() => {
                tunnelProcess.kill();
                reject(new Error('Tunnel setup timeout'));
            }, TUNNEL_READY_TIMEOUT);

            // Handler for both stdout and stderr
            const handleOutput = (data) => {
                output += data;
                logger.debug('Tunnel setup progress:', { data: data.toString() });

                // Check if MySQL tunnel is ready
                if (data.includes('mysql://') && data.includes('database at:')) {
                    isReady = true;
                    // Don't resolve yet, wait for all services to be ready
                }

                // Check if all services are ready (when we see the final message)
                if (data.includes('MAGENTO_CLOUD_RELATIONSHIPS') && isReady) {
                    clearTimeout(timeout);
                    resolve(true);
                }
            };

            tunnelProcess.stdout.on('data', handleOutput);
            tunnelProcess.stderr.on('data', handleOutput);

            tunnelProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (!isReady) {
                    logger.error('Tunnel process closed before ready:', {
                        code,
                        output,
                        projectId,
                        environment
                    });
                    reject(new Error('Tunnel setup failed: ' + output));
                }
            });
        });
    }

    async openTunnel(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;

        // Check if tunnel is already being opened
        if (this.activeTunnels.get(tunnelKey)) {
            return this.activeTunnels.get(tunnelKey);
        }

        try {
            // Try to get existing tunnel info first, but don't log error if tunnel doesn't exist
            let existingTunnel;
            try {
                existingTunnel = await this.getTunnelInfo(projectId, environment);
                if (existingTunnel?.database?.[0]?.url) {
                    this.resetIdleTimer(projectId, environment);
                    return existingTunnel;
                }
            } catch (error) {
                // Only close existing tunnels if there was a different error
                if (!error.message.includes('No tunnels found')) {
                    try {
                        await execAsync('magento-cloud tunnel:close -y');
                    } catch (closeError) {
                        // Ignore close errors
                    }
                }
            }

            // Create promise for tunnel setup
            const tunnelPromise = (async () => {
                logger.info('Opening new tunnel...', { projectId, environment });

                // Wait for tunnel to open and be ready
                await this.waitForTunnelOpen(projectId, environment);

                // Small delay to ensure tunnel is fully established
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Get tunnel info
                const tunnelInfo = await this.getTunnelInfo(projectId, environment);
                if (!tunnelInfo?.database?.[0]?.url) {
                    throw new Error('Failed to get tunnel connection info');
                }

                logger.info('Tunnel successfully established', {
                    projectId,
                    environment
                });

                this.resetIdleTimer(projectId, environment);
                return tunnelInfo;
            })();

            // Store the promise
            this.activeTunnels.set(tunnelKey, tunnelPromise);

            // Wait for tunnel setup to complete
            const result = await tunnelPromise;

            // Clear the stored promise
            this.activeTunnels.delete(tunnelKey);

            return result;
        } catch (error) {
            this.activeTunnels.delete(tunnelKey);
            logger.error('Failed to open tunnel:', {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        }
    }

    async getTunnelInfo(projectId, environment) {
        try {
            const { stdout } = await this.magentoCloud.executeCommand(
                `tunnel:info -p ${projectId} -e ${environment} -y`
            );
            return this.parseTunnelInfo(stdout);
        } catch (error) {
            if (!error.message.includes('No tunnels found')) {
                logger.error('Failed to get tunnel info:', {
                    error: error.message,
                    projectId,
                    environment
                });
            }
            throw error;
        }
    }

    parseTunnelInfo(output) {
        const services = {};
        let currentService = null;
        let currentObject = null;

        output.split('\n').forEach(line => {
            // Remove excessive whitespace
            line = line.trim();

            // Check for service name (ends with colon)
            const serviceMatch = line.match(/^(\w+[-]?\w*):$/);
            if (serviceMatch) {
                currentService = serviceMatch[1];
                services[currentService] = [];
                return;
            }

            // Check for new array item
            if (line === '-') {
                currentObject = {};
                if (currentService) {
                    services[currentService].push(currentObject);
                }
                return;
            }

            // Parse key-value pairs
            const kvMatch = line.match(/^(\w+):\s*(.+)$/);
            if (kvMatch && currentObject) {
                const [, key, value] = kvMatch;

                // Remove quotes if present
                const cleanValue = value.replace(/^['"]|['"]$/g, '');

                currentObject[key] = cleanValue;
            }
        });

        return services;
    }

    resetIdleTimer(projectId, environment) {
        const key = `${projectId}-${environment}`;

        // Clear existing timer if any
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        // Set new timer
        const timer = setTimeout(async () => {
            await this.closeTunnel(projectId, environment);
        }, this.idleTimeout);

        this.timers.set(key, timer);
    }

    async closeTunnel(projectId, environment) {
        try {
            await this.magentoCloud.executeCommand('tunnel:close -y');
            const key = `${projectId}-${environment}`;
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
                this.timers.delete(key);
            }
        } catch (error) {
            logger.error('Failed to close tunnel:', {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        }
    }
}

export const tunnelManager = new TunnelManager();