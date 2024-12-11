// src/services/tunnelService.js
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

const execAsync = promisify(exec);
const TUNNEL_READY_TIMEOUT = 120000; // 2 minutes
const IDLE_TIMEOUT = 120000; // 2 minutes

class TunnelManager {
    constructor() {
        this.timers = new Map();
        this.tunnelPromises = new Map(); // Track ongoing tunnel creation attempts
        this.magentoCloud = new MagentoCloudAdapter();
    }

    parseExistingTunnelOutput(output) {
        const services = {};
        const lines = output.split('\n');

        lines.forEach(line => {
            const alreadyOpenMatch = line.match(/relationship\s+(\w+(?:-\w+)?),\s+at:\s+(\S+)/);
            const newOpenMatch = line.match(/SSH tunnel opened to\s+(\w+(?:-\w+)?)\s+at:\s+(\S+)/);

            const match = alreadyOpenMatch || newOpenMatch;
            if (match) {
                const [, service, url] = match;
                if (!services[service]) {
                    services[service] = [];
                }

                const urlObj = new URL(url);
                const serviceInfo = {
                    username: urlObj.username || null,
                    password: urlObj.password || null,
                    host: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname?.slice(1) || null,
                    url: url
                };

                services[service].push(serviceInfo);
            }
        });

        return services;
    }

    async waitForTunnelOpen(projectId, environment) {
        return new Promise((resolve, reject) => {
            const command = `tunnel:open -p ${projectId} -e ${environment} -y`;
            const { tunnelProcess } = this.magentoCloud.executeCommandStream(command);
            let output = '';

            const timeout = setTimeout(() => {
                tunnelProcess.kill();
                reject(new Error('Tunnel setup timeout'));
            }, TUNNEL_READY_TIMEOUT);

            tunnelProcess.stdout.on('data', (data) => {
                output += data;
                logger.debug('Tunnel setup progress:', { data: data.toString() });

                if (data.includes('A tunnel is already opened')) {
                    const services = this.parseExistingTunnelOutput(output);
                    if (Object.keys(services).length > 0) {
                        clearTimeout(timeout);
                        resolve(services);
                        return;
                    }
                }

                if (data.includes('MAGENTO_CLOUD_RELATIONSHIPS')) {
                    clearTimeout(timeout);
                    resolve(this.parseExistingTunnelOutput(output));
                }
            });

            tunnelProcess.stderr.on('data', (data) => {
                output += data;
                logger.debug('Tunnel stderr:', { data: data.toString() });
            });

            tunnelProcess.on('close', (code) => {
                clearTimeout(timeout);
                const services = this.parseExistingTunnelOutput(output);
                if (Object.keys(services).length > 0) {
                    resolve(services);
                } else {
                    reject(new Error('Tunnel setup failed: ' + output));
                }
            });
        });
    }

    async getTunnelInfo(projectId, environment) {
        try {
            const { stdout } = await this.magentoCloud.executeCommand(
                `tunnel:info -p ${projectId} -e ${environment} -y`
            );
            return this.parseTunnelInfo(stdout);
        } catch (error) {
            if (error.message.includes('No tunnels found')) {
                return null;
            }
            throw error;
        }
    }

    async openTunnel(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;

        try {
            // First, check if we already have a tunnel being created
            const existingPromise = this.tunnelPromises.get(tunnelKey);
            if (existingPromise) {
                return existingPromise;
            }

            // Check for existing tunnel info
            let tunnelInfo = await this.getTunnelInfo(projectId, environment);
            if (tunnelInfo) {
                this.resetIdleTimer(projectId, environment);
                return tunnelInfo;
            }

            // Create new tunnel promise
            const tunnelPromise = (async () => {
                logger.info('Opening new tunnel...', { projectId, environment });
                try {
                    const info = await this.waitForTunnelOpen(projectId, environment);
                    logger.info('Tunnel successfully established', {
                        projectId,
                        environment
                    });
                    this.resetIdleTimer(projectId, environment);
                    return info;
                } finally {
                    // Clean up promise reference when done
                    this.tunnelPromises.delete(tunnelKey);
                }
            })();

            // Store the promise before starting the operation
            this.tunnelPromises.set(tunnelKey, tunnelPromise);
            return tunnelPromise;

        } catch (error) {
            logger.error('Failed to open tunnel:', {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        }
    }

    resetIdleTimer(projectId, environment) {
        const key = `${projectId}-${environment}`;
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }
        const timer = setTimeout(async () => {
            await this.closeTunnel(projectId, environment);
        }, IDLE_TIMEOUT);
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
            // Also clean up any lingering promise
            this.tunnelPromises.delete(key);
        } catch (error) {
            logger.error('Failed to close tunnel:', {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        }
    }

    parseTunnelInfo(output) {
        const services = {};
        let currentService = null;
        let currentObject = null;

        output.split('\n').forEach(line => {
            line = line.trim();

            const serviceMatch = line.match(/^(\w+[-]?\w*):$/);
            if (serviceMatch) {
                currentService = serviceMatch[1];
                services[currentService] = [];
                return;
            }

            if (line === '-') {
                currentObject = {};
                if (currentService) {
                    services[currentService].push(currentObject);
                }
                return;
            }

            const kvMatch = line.match(/^(\w+):\s*(.+)$/);
            if (kvMatch && currentObject) {
                const [, key, value] = kvMatch;
                const cleanValue = value.replace(/^['"]|['"]$/g, '');
                currentObject[key] = cleanValue;
            }
        });

        return services;
    }
}

export const tunnelManager = new TunnelManager();