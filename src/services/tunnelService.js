import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';
import { redisClient } from './redisService.js';

const execAsync = promisify(exec);
const TUNNEL_READY_TIMEOUT = 10000; // 10 seconds
const IDLE_TIMEOUT = 120000; // 2 minutes
const LOCK_TIMEOUT = 10000; // 10 seconds for lock acquisition
const LOCK_RETRY_DELAY = 500; // 500ms between retries
const STATUS_CHECK_INTERVAL = 1000; // 1 second between status checks

class TunnelManager {
    constructor() {
        this.timers = new Map();
        this.magentoCloud = new MagentoCloudAdapter();
    }

    async checkTunnelHealth(tunnelInfo) {
        if (!tunnelInfo) return false;
    
        try {
            // Check the most critical services
            if (tunnelInfo?.redis?.[0]) {
                const { host, port } = tunnelInfo.redis[0];
                const command = `redis-cli -h ${host} -p ${port} ping`;
                const { stdout } = await execAsync(command);
                if (stdout.trim() !== 'PONG') {
                    return false;
                }
            }
    
            // Add more health checks if needed for other services
            return true;
        } catch (error) {
            logger.debug('Tunnel health check failed:', {
                error: error.message
            });
            return false;
        }
    }

    async acquireLock(lockKey) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < LOCK_TIMEOUT) {
            const acquired = await redisClient.set(
                `tunnel_lock:${lockKey}`,
                'locked',
                {
                    NX: true,
                    EX: Math.ceil(LOCK_TIMEOUT / 1000) + 10 // Add 10 seconds buffer
                }
            );

            if (acquired) {
                logger.debug('Lock acquired', { lockKey });
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY));
        }

        logger.warn('Failed to acquire lock after timeout', { lockKey });
        return false;
    }

    async releaseLock(lockKey) {
        await redisClient.del(`tunnel_lock:${lockKey}`);
        logger.debug('Lock released', { lockKey });
    }

    async getTunnelStatus(projectId, environment) {
        const key = `tunnel_status:${projectId}-${environment}`;
        const status = await redisClient.get(key);
        return status ? JSON.parse(status) : null;
    }

    async setTunnelStatus(projectId, environment, status) {
        const key = `tunnel_status:${projectId}-${environment}`;
        await redisClient.set(key, JSON.stringify(status));
        await redisClient.expire(key, Math.ceil(IDLE_TIMEOUT / 1000));
        logger.debug('Tunnel status updated', { projectId, environment });
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
            let servicesFound = {};
            let allServicesReady = false;
            let tunnelCreationStarted = false;
    
            const timeout = setTimeout(() => {
                tunnelProcess.kill();
                reject(new Error('Tunnel setup timeout'));
            }, TUNNEL_READY_TIMEOUT);
    
            tunnelProcess.stdout.on('data', (data) => {
                const newServices = this.parseExistingTunnelOutput(data.toString());
                servicesFound = { ...servicesFound, ...newServices };
            });
    
            tunnelProcess.stderr.on('data', (data) => {
                // Log tunnel creation start only once
                if (!tunnelCreationStarted && data.includes('SSH tunnel opened to')) {
                    tunnelCreationStarted = true;
                    logger.info('Creating tunnels for all services...', {
                        projectId,
                        environment
                    });
                }
    
                const newServices = this.parseExistingTunnelOutput(data.toString());
                servicesFound = { ...servicesFound, ...newServices };
    
                if (data.includes('Logs are written to:')) {
                    allServicesReady = true;
                    logger.info('All tunnels created successfully', {
                        projectId,
                        environment,
                        services: Object.keys(servicesFound)
                    });
                }
            });
    
            tunnelProcess.on('close', async (code) => {
                clearTimeout(timeout);
                
                if (allServicesReady && Object.keys(servicesFound).length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    try {
                        const { stdout } = await this.magentoCloud.executeCommand(
                            `tunnel:info -p ${projectId} -e ${environment} -y`
                        );
                        const tunnelInfo = this.parseTunnelInfo(stdout);
                        resolve(tunnelInfo);
                    } catch (error) {
                        // If tunnel info isn't ready yet, use the parsed services
                        if (error.message.includes('No tunnels found')) {
                            logger.debug('Using parsed services while tunnel info stabilizes');
                            resolve(servicesFound);
                        } else {
                            throw error;
                        }
                    }
                } else {
                    reject(new Error('Tunnel setup incomplete'));
                }
            });
        });
    }
    
    async getTunnelInfo(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;
        try {
            const { stdout } = await this.magentoCloud.executeCommand(
                `tunnel:info -p ${projectId} -e ${environment} -y`
            );
            const tunnelInfo = this.parseTunnelInfo(stdout);
    
            if (Object.keys(tunnelInfo).length > 0) {
                const isHealthy = await this.checkTunnelHealth(tunnelInfo);
                if (!isHealthy) {
                    logger.debug('Tunnel exists but is unhealthy, will be recreated', {
                        projectId,
                        environment
                    });
    
                    try {
                        await this.magentoCloud.executeCommand('tunnel:close -y');
                    } catch (closeError) {
                        logger.debug('Error closing unhealthy tunnel', {
                            error: closeError.message
                        });
                    }
                    return null;
                }
                return tunnelInfo;
            }
            return null;
        } catch (error) {
            if (error.message.includes('No tunnels found')) {
                // Check if a tunnel is expected to be open
                if (this.timers.has(tunnelKey)) {
                    logger.info('Tunnel closed as expected, no tunnel info available', { projectId, environment });
                } else {
                    logger.debug('No tunnels found (tunnel might not be open yet)', { projectId, environment });
                }
                return null;
            }
            throw error;
        }
    }

    async openTunnel(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;
        const maxRetries = 3;
        let retryCount = 0;
        const LOCK_WAIT_TIMEOUT = 30000; // 30 seconds to wait for lock
    
        while (retryCount < maxRetries) {
            try {
                // First quick check for existing tunnel
                let tunnelInfo = await this.getTunnelInfo(projectId, environment);
                if (tunnelInfo) {
                    this.resetIdleTimer(projectId, environment);
                    return tunnelInfo;
                }
    
                // Try to acquire lock with longer timeout
                const lockAcquired = await this.acquireLock(tunnelKey);
                
                if (!lockAcquired) {
                    logger.debug('Waiting for tunnel creation by another process', {
                        projectId,
                        environment
                    });
                    
                    // Wait for tunnel creation with increased timeout
                    const startTime = Date.now();
                    while (Date.now() - startTime < LOCK_WAIT_TIMEOUT) {
                        tunnelInfo = await this.getTunnelInfo(projectId, environment);
                        if (tunnelInfo) {
                            this.resetIdleTimer(projectId, environment);
                            return tunnelInfo;
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Reduced polling frequency
                    }
                    
                    // If we reach here, the wait timed out
                    retryCount++;
                    continue;
                }
    
                try {
                    logger.info('Starting tunnel creation...', { 
                        projectId, 
                        environment,
                        attempt: retryCount + 1
                    });
                    
                    const newTunnelInfo = await this.waitForTunnelOpen(projectId, environment);
                    
                    // Give services time to initialize
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    // Verify tunnel is working
                    const isHealthy = await this.checkTunnelHealth(newTunnelInfo);
                    if (isHealthy) {
                        this.resetIdleTimer(projectId, environment);
                        logger.info('Tunnel successfully created and verified', {
                            projectId,
                            environment
                        });
                        return newTunnelInfo;
                    }
                    
                    throw new Error('New tunnel failed health check');
                } finally {
                    await this.releaseLock(tunnelKey);
                }
            } catch (error) {
                retryCount++;
                if (retryCount < maxRetries) {
                    logger.warn(`Retrying tunnel creation (attempt ${retryCount + 1}/${maxRetries})`, {
                        error: error.message,
                        projectId,
                        environment
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // Exponential backoff
                } else {
                    logger.error('Failed to open tunnel after all retries:', {
                        error: error.message,
                        projectId,
                        environment
                    });
                    throw error;
                }
            }
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

        redisClient.set(
            `tunnel_last_activity:${key}`,
            Date.now().toString(),
            { EX: Math.ceil(IDLE_TIMEOUT / 1000) }
        );
    }

    async closeTunnel(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;
        const lockAcquired = await this.acquireLock(tunnelKey);

        if (!lockAcquired) {
            logger.debug('Skipping tunnel close - another process is handling it');
            return;
        }

        try {
            await this.magentoCloud.executeCommand('tunnel:close -y');
            
            const keys = [
                `tunnel_status:${tunnelKey}`,
                `tunnel_last_activity:${tunnelKey}`
            ];
            await redisClient.del(keys);

            if (this.timers.has(tunnelKey)) {
                clearTimeout(this.timers.get(tunnelKey));
                this.timers.delete(tunnelKey);
            }

            logger.info('Tunnel closed successfully', {
                projectId,
                environment
            });
        } catch (error) {
            logger.error('Failed to close tunnel:', {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        } finally {
            await this.releaseLock(tunnelKey);
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

    async getServiceTunnelInfo(projectId, environment, serviceName) {
        try {
            const tunnelInfo = await this.getTunnelInfo(projectId, environment);
            
            // Check if tunnel info exists and has the requested service
            if (!tunnelInfo || !tunnelInfo[serviceName] || !tunnelInfo[serviceName].length) {
                // If tunnel exists but doesn't have the service, try to recreate it
                if (tunnelInfo) {
                    logger.debug(`Tunnel exists but missing ${serviceName} service, recreating...`, {
                        projectId,
                        environment
                    });
                    await this.closeTunnel(projectId, environment);
                    return await this.getServiceTunnelInfo(projectId, environment, serviceName);
                }
                
                // If no tunnel exists, create a new one
                logger.debug(`Creating new tunnel for ${serviceName} service`, {
                    projectId,
                    environment
                });
                const newTunnelInfo = await this.openTunnel(projectId, environment);
                
                if (!newTunnelInfo || !newTunnelInfo[serviceName] || !newTunnelInfo[serviceName].length) {
                    throw new Error(`Service ${serviceName} not available in tunnel configuration`);
                }
                
                return { [serviceName]: newTunnelInfo[serviceName] };
            }
            
            return { [serviceName]: tunnelInfo[serviceName] };
        } catch (error) {
            logger.error(`Failed to get tunnel info for ${serviceName}:`, {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        }
    }
}

export const tunnelManager = new TunnelManager();