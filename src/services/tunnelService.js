// src/services/tunnelService.js
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';
import { logActivity } from './activityLogger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';
import { redisClient } from './redisService.js';
import { v4 as uuidv4 } from 'uuid'; // For unique lock identifiers
import { SQLService } from './sqlService.js';
import { OpenSearchService } from './openSearchService.js';

const execAsync = promisify(exec);

// Times in ms
const TUNNEL_READY_TIMEOUT = 15000; // 15s waiting for "tunnel:open" to respond (increased from 10s)
const IDLE_TIMEOUT = 120000;        // 2 minutes
const LOCK_TIMEOUT = 30000;         // 30s for lock acquisition
const LOCK_RETRY_DELAY = 1000;      // 1s between lock retries

/**
 * The TunnelManager handles open/close logic for a single SSH tunnel per (projectId, environment).
 * This is concurrency-safe by using a Redis lock and manages per-user access.
 */
class TunnelManager {
    constructor() {
        this.tunnelUsers = new Map(); // Map<`${projectId}-${environment}`, Set<userId>>
        this.idleTimers = new Map();  // Map<`${projectId}-${environment}-${userId}`, Timeout>
        this.magentoCloud = new MagentoCloudAdapter();
    }

    /**
     * Acquire a Redis-based lock for a specific key with ownership.
     * Returns a unique lock identifier if acquired, else null.
     */
    async acquireLock(lockKey) {
        const lockId = uuidv4();
        const startTime = Date.now();

        while (Date.now() - startTime < LOCK_TIMEOUT) {
            try {
                const acquired = await redisClient.set(
                    `tunnel_lock:${lockKey}`,
                    lockId,
                    {
                        NX: true,
                        EX: Math.ceil(LOCK_TIMEOUT / 1000) + 15 // Buffer time
                    }
                );

                if (acquired === 'OK') {
                    logger.debug('Lock acquired', { lockKey, lockId });
                    return lockId;
                }
            } catch (error) {
                logger.error('Error acquiring lock:', { error: error.message, lockKey });
                return null;
            }

            // Wait for the retry delay before retrying
            await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY));
        }

        logger.warn('Failed to acquire lock after timeout', { lockKey });
        return null;
    }

    /**
     * Release the Redis-based lock for the given lockKey if the lockId matches.
     */
    async releaseLock(lockKey, lockId) {
        // Type checks
        if (typeof lockKey !== 'string') {
            logger.error('Invalid lockKey type:', { lockKey, type: typeof lockKey });
            throw new Error('lockKey must be a string');
        }

        if (typeof lockId !== 'string') {
            logger.error('Invalid lockId type:', { lockId, type: typeof lockId });
            throw new Error('lockId must be a string');
        }

        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        const key = `tunnel_lock:${lockKey}`;

        try {
            const result = await redisClient.eval(script, {
                keys: [key],
                arguments: [lockId]
            });
            if (result === 1) {
                logger.debug('Lock released', { lockKey, lockId });
            } else {
                logger.warn('Lock not released - lockId did not match', { lockKey, lockId });
            }
        } catch (error) {
            logger.error('Failed to execute Lua script for lock release:', { error: error.message, lockKey, lockId });
            throw error;
        }
    }

    /**
     * Increments the reference count for a tunnel when a user starts using it.
     */
    async incrementTunnelUsage(projectId, environment, userId) {
        const key = `${projectId}-${environment}`;
        if (!this.tunnelUsers.has(key)) {
            this.tunnelUsers.set(key, new Set());
        }
        this.tunnelUsers.get(key).add(userId);
        logger.debug('Tunnel usage incremented', { key, userId, totalUsers: this.tunnelUsers.get(key).size });
    }

    /**
     * Decrements the reference count for a tunnel when a user stops using it.
     * If no users are left, initiates tunnel closure.
     */
    async decrementTunnelUsage(projectId, environment, userId, apiToken) {
        const key = `${projectId}-${environment}`;
        if (this.tunnelUsers.has(key)) {
            this.tunnelUsers.get(key).delete(userId);
            logger.debug('Tunnel usage decremented', { key, userId, remainingUsers: this.tunnelUsers.get(key).size });

            if (this.tunnelUsers.get(key).size === 0) {
                logger.info('No more users using the tunnel. Initiating closure.', { key });
                await this.closeTunnel(projectId, environment, apiToken, userId);
            }
        }
    }

    /**
     * Retrieves the tunnel info from Magento Cloud. If no tunnel is found or
     * the tunnel is unhealthy, returns null.
     */
    async getTunnelInfo(projectId, environment, apiToken, userId) {
        const tunnelKey = `${projectId}-${environment}`;
        try {
            const { stdout } = await this.magentoCloud.executeCommand(
                `tunnel:info -p ${projectId} -e ${environment} -y`,
                apiToken, userId
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
                        await this.magentoCloud.executeCommand('tunnel:close -y', apiToken, userId);
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
                logger.debug('No tunnels found (not open yet)', { projectId, environment });
                return null;
            }
            throw error;
        }
    }

    /**
     * Checks if the provided tunnel info is healthy for a specific service.
     * If no service is specified, it performs a general check using Redis.
     */
    async checkTunnelHealth(tunnelInfo, serviceName = 'redis') { // Default to redis
        if (!tunnelInfo) return false;

        try {
            // Support both Redis and Valkey as Redis-compatible services
            if ((serviceName === 'redis' || serviceName === 'valkey')) {
                // Prefer redis if present, otherwise try valkey
                const redisInfo = tunnelInfo.redis?.[0] || tunnelInfo.valkey?.[0];
                if (redisInfo) {
                    const { host, port } = redisInfo;
                    try {
                        const { stdout } = await execAsync(`redis-cli -h ${host} -p ${port} ping`, { timeout: 5000 });
                        return stdout.trim() === 'PONG';
                    } catch (redisError) {
                        // If redis-cli is not available or connection fails, consider it a temporary issue
                        logger.debug(`Redis health check failed (may be temporary):`, { 
                            error: redisError.message, 
                            host, 
                            port,
                            serviceName 
                        });
                        // Don't fail immediately - let the retry logic handle it
                        return false;
                    }
                }
            }
            if (serviceName === 'sql' && tunnelInfo.database?.[0]) {
                try {
                    const sqlService = new SQLService({ database: [tunnelInfo.database[0]] });
                    await sqlService.executeQuery('SELECT 1');
                    return true;
                } catch (sqlError) {
                    logger.debug(`SQL health check failed (may be temporary):`, { 
                        error: sqlError.message, 
                        serviceName 
                    });
                    return false;
                }
            }
            if (serviceName === 'opensearch' && tunnelInfo.opensearch?.[0]) {
                try {
                    const osService = new OpenSearchService({ opensearch: [tunnelInfo.opensearch[0]] });
                    // A simple GET request to the root is a good health check.
                    await osService.executeCommand({ method: 'GET', path: '/' });
                    return true;
                } catch (osError) {
                    logger.debug(`OpenSearch health check failed (may be temporary):`, { 
                        error: osError.message, 
                        serviceName 
                    });
                    return false;
                }
            }
        } catch (error) {
            logger.debug(`Tunnel health check failed for ${serviceName}:`, { error: error.message });
            return false;
        }

        return false; // Service not found or not supported
    }

    /**
     * Polls the tunnel until a specific service is healthy and ready.
     */
    async waitForServiceReady(projectId, environment, serviceName, apiToken, userId) {
        const POLL_INTERVAL = 3000; // 3 seconds (increased from 2s)
        const MAX_WAIT_TIME = 60000; // 60 seconds (increased from 30s)
        const startTime = Date.now();

        while (Date.now() - startTime < MAX_WAIT_TIME) {
            const tunnelInfo = await this.getTunnelInfo(projectId, environment, apiToken, userId);
            if (tunnelInfo) {
                const isHealthy = await this.checkTunnelHealth(tunnelInfo, serviceName);
                if (isHealthy) {
                    logger.info(`Service "${serviceName}" is ready in tunnel.`, { projectId, environment });
                    return tunnelInfo;
                }
            }
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }

        throw new Error(`Service "${serviceName}" was not ready within the timeout period.`);
    }

    /**
     * Parses standard "tunnel:info" output into a structured object:
     * {
     *   redis: [{ host, port, username, password, ... }],
     *   mysql: [{ host, port, ... }],
     *   elasticsearch: [{ host, port, ... }],
     *   opensearch: [{ host, port, ... }],
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

                try {
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
                } catch (err) {
                    logger.warn('Failed to parse URL in tunnel output:', { url, error: err.message });
                }
            }
        });

        return services;
    }

    /**
     * Waits for the tunnel to open by spawning "tunnel:open" and parsing its output.
     * This resolves with the tunnel info once all services are reported as ready.
     */
    async waitForTunnelOpen(projectId, environment, apiToken, userId, serviceType) {
        return new Promise((resolve, reject) => {
            const command = `tunnel:open -p ${projectId} -e ${environment} -y`;
            const { tunnelProcess } = this.magentoCloud.executeCommandStream(command, apiToken, userId);

            let servicesFound = {};
            let allServicesReady = false;

            // Safety timeout
            const timeout = setTimeout(() => {
                tunnelProcess.kill();
                reject(new Error('Tunnel setup timeout'));
            }, TUNNEL_READY_TIMEOUT);

            const dataHandler = (data) => {
                const dataStr = data.toString();
                const newServices = this.parseExistingTunnelOutput(dataStr);
                servicesFound = { ...servicesFound, ...newServices };

                if (dataStr.includes('Logs are written to:')) {
                    allServicesReady = true;
                    logger.info('All tunnels appear to be created successfully.', {
                        projectId,
                        environment,
                        services: Object.keys(servicesFound)
                    });
                }
            };

            tunnelProcess.stdout.on('data', dataHandler);
            tunnelProcess.stderr.on('data', dataHandler);

            tunnelProcess.on('close', async (code) => {
                clearTimeout(timeout);

                logger.debug(`Tunnel process closed with code: ${code}`, { projectId, environment });

                if (allServicesReady && Object.keys(servicesFound).length > 0) {
                    try {
                        // Use the specific serviceType for polling if provided, otherwise default to redis.
                        const serviceToCheck = serviceType || 'redis';
                        const finalTunnelInfo = await this.waitForServiceReady(projectId, environment, serviceToCheck, apiToken, userId);
                        resolve(finalTunnelInfo);
                    } catch (error) {
                        logger.error('Service readiness check failed after tunnel open:', { error: error.message });
                        resolve(servicesFound); // Fallback to what we found
                    }
                } else {
                    reject(new Error(`Tunnel setup incomplete. Process exited with code ${code}.`));
                }
            });

            tunnelProcess.on('error', (error) => {
                clearTimeout(timeout);
                logger.error('Tunnel process encountered an error:', { error: error.message });
                reject(error);
            });
        });
    }

    /**
     * The main entrypoint to ensure a tunnel is open for the specified project/env.
     * If already open and healthy, returns the existing info. Otherwise, tries to acquire a lock and open it.
     */
    async openTunnel(projectId, environment, apiToken, userId, serviceType, progressCallback) {
        if (!userId) {
            throw new Error("userId is not provided");
        }

        if (!apiToken) {
            throw new Error('API token not found for user');
        }

        logger.info('openTunnel called', {
            projectId,
            environment,
            userId,
            hasApiToken: !!apiToken,
            apiTokenLength: apiToken ? apiToken.length : 0
        });

        const tunnelKey = `${projectId}-${environment}`;
        const maxRetries = 3;
        let retryCount = 0;
        // Wait for another process to open the tunnel if we fail to get the lock
        const LOCK_WAIT_TIMEOUT = 30000;

        while (retryCount < maxRetries) {
            try {
                // Quick check for existing tunnel
                if (progressCallback) progressCallback('checking_existing_tunnel');
                let tunnelInfo = await this.getTunnelInfo(projectId, environment, apiToken, userId);
                if (tunnelInfo && await this.checkTunnelHealth(tunnelInfo, serviceType)) {
                    if (progressCallback) progressCallback('tunnel_exists');
                    await this.incrementTunnelUsage(projectId, environment, userId);
                    this.resetIdleTimer(projectId, environment, userId, apiToken);
                    return tunnelInfo;
                }

                // Acquire lock
                if (progressCallback) progressCallback('acquiring_lock');
                const lockId = await this.acquireLock(tunnelKey);
                if (!lockId) {
                    if (progressCallback) progressCallback('waiting_for_lock');
                    logger.debug('Waiting for tunnel creation by another process...', { projectId, environment });

                    // Wait for the other process to finish opening
                    const startTime = Date.now();
                    while (Date.now() - startTime < LOCK_WAIT_TIMEOUT) {
                        tunnelInfo = await this.getTunnelInfo(projectId, environment, apiToken, userId);
                        if (tunnelInfo && await this.checkTunnelHealth(tunnelInfo, serviceType)) {
                            if (progressCallback) progressCallback('tunnel_opened_by_other_process');
                            await this.incrementTunnelUsage(projectId, environment, userId);
                            this.resetIdleTimer(projectId, environment, userId, apiToken);
                            return tunnelInfo;
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }

                    retryCount++;
                    continue;
                }

                // If we have the lock, proceed to open
                try {
                    logger.info(`Starting tunnel creation... Attempt ${retryCount + 1} of ${maxRetries}`, {
                        projectId,
                        environment
                    });

                    if (progressCallback) progressCallback('opening_tunnel');
                    const newTunnelInfo = await this.waitForTunnelOpen(projectId, environment, apiToken, userId, serviceType);

                    // Add a grace period for the tunnel to stabilize before health checks
                    if (progressCallback) progressCallback('tunnel_stabilizing');
                    logger.info('Tunnel created, waiting for stabilization...', { projectId, environment });
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second grace period

                    // Verify the new tunnel is healthy for the specific service
                    if (progressCallback) progressCallback('verifying_tunnel');
                    const isHealthy = await this.checkTunnelHealth(newTunnelInfo, serviceType);
                    if (isHealthy) {
                        if (progressCallback) progressCallback('tunnel_ready');
                        await this.incrementTunnelUsage(projectId, environment, userId);
                        this.resetIdleTimer(projectId, environment, userId, apiToken);
                        logger.info('Tunnel successfully created and verified', { projectId, environment });
                        
                        // Log tunnel opened activity
                        logActivity.tunnel.opened(userId, 'system', projectId, environment);
                        
                        return newTunnelInfo;
                    }
                    throw new Error('New tunnel failed health check');
                } finally {
                    await this.releaseLock(tunnelKey, lockId);
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
     * Resets the idle timer for a specific user-tunnel pair so that the tunnel is closed automatically after IDLE_TIMEOUT ms
     * if there's no further usage by that user.
     */
    async resetIdleTimer(projectId, environment, userId, apiToken) {
        const key = `${projectId}-${environment}-${userId}`;
        if (this.idleTimers.has(key)) {
            clearTimeout(this.idleTimers.get(key));
        }

        if (!apiToken) {
            logger.error('API token not found for user. Cannot close tunnel automatically.');
            return;
        }

        const timer = setTimeout(async () => {
            try {
                await this.decrementTunnelUsage(projectId, environment, userId, apiToken);
            } catch (error) {
                logger.error('Error while closing tunnel automatically:', { error: error.message });
            }
        }, IDLE_TIMEOUT);

        this.idleTimers.set(key, timer);
        logger.debug('Idle timer set/reset', { key });

        // Also store last activity in Redis with an expiry
        try {
            await redisClient.set(
                `tunnel_last_activity:${projectId}-${environment}-${userId}`,
                Date.now().toString(),
                { EX: Math.ceil(IDLE_TIMEOUT / 1000) }
            );
        } catch (error) {
            logger.error('Failed to set tunnel_last_activity in Redis:', { error: error.message, key });
        }
    }

    /**
     * Closes the tunnel by acquiring the lock, calling "tunnel:close -y", and removing
     * relevant Redis keys and timers.
     */
    async closeTunnel(projectId, environment, apiToken, userId) {
        const tunnelKey = `${projectId}-${environment}`;
        const lockId = await this.acquireLock(tunnelKey);
        if (!lockId) {
            logger.debug('Skipping tunnel close - another process is handling it', { projectId, environment });
            return;
        }

        try {
            await this.magentoCloud.executeCommand('tunnel:close -y', apiToken, userId);
            await redisClient.del(`tunnel_status:${tunnelKey}`);

            // Using scanIterator for node-redis v4+
            const iterator = redisClient.scanIterator({
                MATCH: `tunnel_last_activity:${tunnelKey}-*`,
                COUNT: 100
            });

            for await (const key of iterator) {
                await redisClient.del(key);
            }

            logger.debug('All tunnel_last_activity keys deleted');

            // Clear all idle timers for the tunnel
            for (const [timerKey, timer] of this.idleTimers.entries()) {
                if (timerKey.startsWith(`${projectId}-${environment}-`)) {
                    clearTimeout(timer);
                    this.idleTimers.delete(timerKey);
                }
            }

            // Clear tunnel users
            this.tunnelUsers.delete(tunnelKey);

            logger.info('Tunnel closed successfully', { projectId, environment });
            
            // Log tunnel closed activity
            if (userId) {
                logActivity.tunnel.closed(userId, 'system', projectId, environment);
            }
        } catch (error) {
            logger.error('Failed to close tunnel:', { error: error.message, projectId, environment });
            throw error;
        } finally {
            await this.releaseLock(tunnelKey, lockId);
        }
    }

    /**
     * Retrieves tunnel info for a specific service. If it's not in the current tunnel, tries to close+reopen.
     * This is used by your redisCommands, openSearchCommands, etc.
     */
    async getServiceTunnelInfo(projectId, environment, serviceName, apiToken, userId) {
        const alternativeServices = {
            opensearch: 'elasticsearch',
            elasticsearch: 'opensearch',
            redis: 'valkey',
            valkey: 'redis'
        };
    
        try {
            if (!apiToken) {
                throw new Error('API token not found for user');
            }
    
            // Attempt to retrieve the primary service
            let tunnelInfo = await this.getTunnelInfo(projectId, environment, apiToken, userId);
    
            if (tunnelInfo && tunnelInfo[serviceName] && tunnelInfo[serviceName].length > 0) {
                return { [serviceName]: tunnelInfo[serviceName] };
            }
    
            // If the primary service is not available, check for the alternative service
            const alternativeService = alternativeServices[serviceName];
            if (alternativeService && tunnelInfo && tunnelInfo[alternativeService] && tunnelInfo[alternativeService].length > 0) {
                logger.warn(`${serviceName} not found. Falling back to ${alternativeService}.`, {
                    projectId,
                    environment
                });
                return { [alternativeService]: tunnelInfo[alternativeService] };
            }
    
            // If neither service is available, throw an error
            throw new Error(`Neither ${serviceName} nor ${alternativeService} services are available in the tunnel configuration.`);
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

// Graceful shutdown handling
const shutdown = async () => {
    logger.info('Shutting down. Closing all active tunnels...');
    try {
        for (const [key] of tunnelManager.tunnelUsers.entries()) {
            const [projectId, environment] = key.split('-');
            // Assuming you have access to apiToken here. Modify as needed.
            await tunnelManager.closeTunnel(projectId, environment, null); // Pass appropriate apiToken if necessary
        }
    } catch (error) {
        logger.error('Error during tunnel closure on shutdown:', { error: error.message });
    } finally {
        try {
            await redisClient.quit();
            logger.info('Redis client disconnected');
        } catch (err) {
            logger.error('Error disconnecting Redis client:', { error: err.message });
        }
        process.exit(0);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export const tunnelManager = new TunnelManager();
