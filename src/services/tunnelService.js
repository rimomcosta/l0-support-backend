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
        this.activeTunnels = new Map();
        this.magentoCloud = new MagentoCloudAdapter();
    }

    parseExistingTunnelOutput(output) {
        const services = {};
        const lines = output.split('\n');
        
        lines.forEach(line => {
            // Match lines like "A tunnel is already opened to the relationship database, at: mysql://..."
            const alreadyOpenMatch = line.match(/relationship\s+(\w+(?:-\w+)?),\s+at:\s+(\S+)/);
            // Match lines like "SSH tunnel opened to redis at: redis://..."
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
                    path: urlObj.pathname?.slice(1) || null, // Remove leading slash
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

                // If we see this message, tunnels are already open and working
                if (data.includes('A tunnel is already opened')) {
                    const services = this.parseExistingTunnelOutput(output);
                    if (Object.keys(services).length > 0) {
                        clearTimeout(timeout);
                        resolve(services);
                        return;
                    }
                }

                // Check if we see MAGENTO_CLOUD_RELATIONSHIPS mention (completion message)
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
                return null; // Not an error case, just means we need to open a tunnel
            }
            throw error;
        }
    }

    async openTunnel(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;

        // Check if tunnel is already being opened
        if (this.activeTunnels.get(tunnelKey)) {
            return this.activeTunnels.get(tunnelKey);
        }

        try {
            // Try to get existing tunnel info first
            let tunnelInfo = await this.getTunnelInfo(projectId, environment);
            
            if (tunnelInfo) {
                this.resetIdleTimer(projectId, environment);
                return tunnelInfo;
            }

            // Create promise for tunnel setup
            const tunnelPromise = (async () => {
                logger.info('Opening new tunnel...', { projectId, environment });

                // Wait for tunnel to open and be ready
                const tunnelInfo = await this.waitForTunnelOpen(projectId, environment);

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

    resetIdleTimer(projectId, environment) {
        const key = `${projectId}-${environment}`;

        // Clear existing timer if any
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        // Set new timer
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
        } catch (error) {
            logger.error('Failed to close tunnel:', {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        }
    }

    // Helper method to parse tunnel:info output
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