// src/services/tunnelService.js
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';
import { redisClient } from './redisService.js';

const execAsync = promisify(exec);

// Times in ms
const TUNNEL_READY_TIMEOUT = 10000; // 10s waiting for "tunnel:open" to respond
const IDLE_TIMEOUT = 120000;        // 2 minutes
const LOCK_TIMEOUT = 30000;         // 30s for lock acquisition
const LOCK_RETRY_DELAY = 1000;       // 1s between lock retries

/**
 * The TunnelManager handles open/close logic for a single SSH tunnel per (projectId, environment).
 * This is concurrency-safe by using a Redis lock.
 */
class TunnelManager {
    constructor() {
        this.timers = new Map(); 
        this.magentoCloud = new MagentoCloudAdapter();
    }

    /**
     * Checks if the provided tunnel info is healthy. In this example, we ping Redis, but
     * you could add more checks for SQL/OpenSearch if you wish.
     */
    async checkTunnelHealth(tunnelInfo) {
        if (!tunnelInfo) return false;
        try {
            // Check Redis as an example
            if (tunnelInfo?.redis?.[0]) {
                const { host, port } = tunnelInfo.redis[0];
                const command = `redis-cli -h ${host} -p ${port} ping`;
                const { stdout } = await execAsync(command);
                if (stdout.trim() !== 'PONG') {
                    return false;
                }
            }
            // Extend with other checks if needed (SQL, OpenSearch, etc.)
            return true;
        } catch (error) {
            logger.debug('Tunnel health check failed:', { error: error.message });
            return false;
        }
    }

    /**
     * Acquire a Redis-based lock for a specific key (e.g. "projectId-environment").
     * We wait up to LOCK_TIMEOUT ms, retrying every LOCK_RETRY_DELAY ms.
     */
    async acquireLock(lockKey) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < LOCK_TIMEOUT) {
            const acquired = await redisClient.set(
                `tunnel_lock:${lockKey}`,
                'locked',
                {
                    NX: true,
                    // We give a bit more buffer than LOCK_TIMEOUT/1000
                    EX: Math.ceil(LOCK_TIMEOUT / 1000) + 15
                }
            );

            if (acquired) {
                logger.debug('Lock acquired', { lockKey });
                return true;
            }

            // Wait for the retry delay
            await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY));
        }

        logger.warn('Failed to acquire lock after timeout', { lockKey });
        return false;
    }

    /**
     * Release the Redis-based lock for the given lockKey.
     */
    async releaseLock(lockKey) {
        await redisClient.del(`tunnel_lock:${lockKey}`);
        logger.debug('Lock released', { lockKey });
    }

    /**
     * Retrieves the tunnel info from Magento Cloud. If no tunnel is found or
     * the tunnel is unhealthy, returns null.
     */
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
                    logger.debug('Tunnel exists but is unhealthy. Will be recreated.', {
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
                // Possibly not open yet
                if (this.timers.has(tunnelKey)) {
                    logger.info('Tunnel closed as expected, no tunnel info available', { projectId, environment });
                } else {
                    logger.debug('No tunnels found (not open yet)', { projectId, environment });
                }
                return null;
            }
            throw error;
        }
    }

    /**
     * Waits for the tunnel to open by spawning "tunnel:open" and parsing its output.
     * This resolves with the tunnel info once all services are reported as ready.
     */
    async waitForTunnelOpen(projectId, environment) {
        return new Promise((resolve, reject) => {
            const command = `tunnel:open -p ${projectId} -e ${environment} -y`;
            const { tunnelProcess } = this.magentoCloud.executeCommandStream(command);

            let servicesFound = {};
            let allServicesReady = false;
            let tunnelCreationStarted = false;

            // Safety timeout
            const timeout = setTimeout(() => {
                tunnelProcess.kill();
                reject(new Error('Tunnel setup timeout'));
            }, TUNNEL_READY_TIMEOUT);

            tunnelProcess.stdout.on('data', (data) => {
                const newServices = this.parseExistingTunnelOutput(data.toString());
                servicesFound = { ...servicesFound, ...newServices };
            });

            tunnelProcess.stderr.on('data', (data) => {
                if (!tunnelCreationStarted && data.includes('SSH tunnel opened to')) {
                    tunnelCreationStarted = true;
                    logger.info('Creating tunnels for all services...', { projectId, environment });
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
                    // A brief wait to let services "settle"
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    try {
                        const { stdout } = await this.magentoCloud.executeCommand(
                            `tunnel:info -p ${projectId} -e ${environment} -y`
                        );
                        const tunnelInfo = this.parseTunnelInfo(stdout);
                        resolve(tunnelInfo);
                    } catch (error) {
                        if (error.message.includes('No tunnels found')) {
                            logger.debug('Using parsed services while tunnel info stabilizes');
                            resolve(servicesFound);
                        } else {
                            reject(error);
                        }
                    }
                } else {
                    reject(new Error('Tunnel setup incomplete'));
                }
            });
        });
    }

    /**
     * The main entrypoint to ensure a tunnel is open for the specified project/env.
     * If already open and healthy, returns the existing info. Otherwise, tries to acquire a lock and open it.
     */
    async openTunnel(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;
        const maxRetries = 3;
        let retryCount = 0;
        // Wait for another process to open the tunnel if we fail to get the lock
        const LOCK_WAIT_TIMEOUT = 30000; 

        while (retryCount < maxRetries) {
            try {
                // Quick check for existing tunnel
                let tunnelInfo = await this.getTunnelInfo(projectId, environment);
                if (tunnelInfo) {
                    this.resetIdleTimer(projectId, environment);
                    return tunnelInfo;
                }

                // Acquire lock
                const lockAcquired = await this.acquireLock(tunnelKey);
                if (!lockAcquired) {
                    logger.debug('Waiting for tunnel creation by another process...', { projectId, environment });

                    // Wait for the other process to finish opening
                    const startTime = Date.now();
                    while (Date.now() - startTime < LOCK_WAIT_TIMEOUT) {
                        tunnelInfo = await this.getTunnelInfo(projectId, environment);
                        if (tunnelInfo) {
                            this.resetIdleTimer(projectId, environment);
                            return tunnelInfo;
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    retryCount++;
                    continue;
                }

                // If we have the lock, proceed to open
                try {
                    logger.info(`Starting tunnel creation... Attempt ${retryCount + 1} of ${maxRetries}`, 
                                { projectId, environment });

                    const newTunnelInfo = await this.waitForTunnelOpen(projectId, environment);

                    // Give services a bit more time
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Verify the new tunnel is healthy
                    const isHealthy = await this.checkTunnelHealth(newTunnelInfo);
                    if (isHealthy) {
                        this.resetIdleTimer(projectId, environment);
                        logger.info('Tunnel successfully created and verified', { projectId, environment });
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
                    // Exponential-ish backoff
                    await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
                } else {
                    logger.error('Failed to open tunnel after all retries', {
                        error: error.message,
                        projectId,
                        environment
                    });
                    throw error;
                }
            }
        }
    }

    /**
     * Resets the idle timer so that the tunnel is closed automatically after IDLE_TIMEOUT ms
     * if there's no further usage.
     */
    resetIdleTimer(projectId, environment) {
        const key = `${projectId}-${environment}`;
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        const timer = setTimeout(async () => {
            await this.closeTunnel(projectId, environment);
        }, IDLE_TIMEOUT);

        this.timers.set(key, timer);

        // Also store last activity in Redis with an expiry
        redisClient.set(
            `tunnel_last_activity:${key}`,
            Date.now().toString(),
            { EX: Math.ceil(IDLE_TIMEOUT / 1000) }
        );
    }

    /**
     * Closes the tunnel by acquiring the lock, calling "tunnel:close -y", and removing
     * relevant Redis keys and timeouts.
     */
    async closeTunnel(projectId, environment) {
        const tunnelKey = `${projectId}-${environment}`;
        const lockAcquired = await this.acquireLock(tunnelKey);
        if (!lockAcquired) {
            logger.debug('Skipping tunnel close - another process is handling it', { projectId, environment });
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

            logger.info('Tunnel closed successfully', { projectId, environment });
        } catch (error) {
            logger.error('Failed to close tunnel:', { error: error.message, projectId, environment });
            throw error;
        } finally {
            await this.releaseLock(tunnelKey);
        }
    }

    /**
     * Parses standard "tunnel:info" output into a structured object:
     * {
     *   redis: [{ host, port, username, password, ... }],
     *   mysql: [{ host, port, ... }],
     *   ...
     * }
     */
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

    /**
     * When parsing "tunnel:open" output or logs, we detect lines like:
     * "relationship redis, at: redis://user:pass@hostname:port"
     * or
     * "SSH tunnel opened to redis at: redis://user:pass@hostname:port"
     * This helps us construct a partial service object.
     */
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
                    url
                };
                services[service].push(serviceInfo);
            }
        });

        return services;
    }

    /**
     * Retrieves tunnel info for a specific service. If it's not in the current tunnel, tries to close+reopen.
     * This is used by your redisCommands, openSearchCommands, etc.
     */
    async getServiceTunnelInfo(projectId, environment, serviceName) {
        try {
            const tunnelInfo = await this.getTunnelInfo(projectId, environment);

            // If tunnel is missing or doesn't have the requested service, attempt recreation
            if (!tunnelInfo || !tunnelInfo[serviceName] || !tunnelInfo[serviceName].length) {
                if (tunnelInfo) {
                    logger.debug(`Tunnel exists but missing ${serviceName} service. Recreating...`, {
                        projectId,
                        environment
                    });
                    await this.closeTunnel(projectId, environment);
                } else {
                    logger.debug(`Creating new tunnel for ${serviceName} service`, {
                        projectId,
                        environment
                    });
                }
                const newTunnelInfo = await this.openTunnel(projectId, environment);

                if (!newTunnelInfo || !newTunnelInfo[serviceName] || !newTunnelInfo[serviceName].length) {
                    throw new Error(`Service ${serviceName} not available in tunnel configuration`);
                }

                return { [serviceName]: newTunnelInfo[serviceName] };
            }

            // If the service is present in the existing tunnel
            return { [serviceName]: tunnelInfo[serviceName] };
        } catch (error) {
            logger.error(`Failed to get tunnel info for ${serviceName}`, {
                error: error.message,
                projectId,
                environment
            });
            throw error;
        }
    }
}

export const tunnelManager = new TunnelManager();
