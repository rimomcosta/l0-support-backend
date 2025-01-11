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

export async function cleanupSession(sessionId) {
    try {
        await redisClient.del(`sess:${sessionId}`);
        await redisClient.del(`user_context:${sessionId}`);
        logger.debug('Redis session cleanup successful', { sessionId });
    } catch (error) {
        logger.error('Redis session cleanup failed:', {
            error: error.message,
            sessionId
        });
        throw error;
    }
}

export async function cleanupAllSessions() {
    try {
        const sessionKeys = await redisClient.keys('sess:*');
        const contextKeys = await redisClient.keys('user_context:*');
        const allKeys = [...sessionKeys, ...contextKeys];
        
        if (allKeys.length > 0) {
            await redisClient.del(allKeys);
        }
        logger.info('All Redis sessions cleaned up successfully');
    } catch (error) {
        logger.error('Failed to cleanup all Redis sessions:', error);
        throw error;
    }
}