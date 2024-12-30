//src/services/redisService.js
import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import { logger } from './logger.js';

export const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379')
    },
    password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.on('connect', () => logger.info('Redis Client Connected'));

export async function initializeRedis() {
    await redisClient.connect().catch(err => {
        logger.error('Redis connection failed:', err);
        process.exit(1);
    });
}

export function createSessionStore() {
    return new RedisStore({
        client: redisClient,
        prefix: 'sess:',
        ttl: 86400,
        disableTouch: false
    });
}