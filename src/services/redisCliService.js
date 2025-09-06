// src/services/redisCliService.js
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';

const execAsync = promisify(exec);

export class RedisCliService {
    constructor(tunnelInfo) {
        // Support both Redis and Valkey services
        const redisInfo = tunnelInfo.redis?.[0] || tunnelInfo.valkey?.[0];
        
        if (!redisInfo) {
            throw new Error('Invalid tunnel info: missing redis or valkey configuration');
        }

        this.host = redisInfo.host;
        this.port = redisInfo.port;
        this.serviceType = tunnelInfo.redis?.[0] ? 'redis' : 'valkey';

        logger.debug('Redis CLI Service initialized with config:', {
            host: this.host,
            port: this.port,
            serviceType: this.serviceType
        });
    }

    async executeCommand(command) {
        try {
            const redisCommand = `redis-cli -h ${this.host} -p ${this.port} ${command}`;
            logger.debug('Executing Redis command:', { command: redisCommand });

            const { stdout, stderr } = await execAsync(redisCommand);
            
            if (stderr) {
                throw new Error(stderr);
            }

            return stdout.trim();
        } catch (error) {
            logger.error('Redis command execution failed:', {
                error: error.message,
                command,
                host: this.host,
                port: this.port
            });
            throw error;
        }
    }
}