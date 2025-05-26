// src/services/sessionService.js
import { redisClient } from './redisService.js';
import { logger } from './logger.js';

export class SessionService {
    static async storeUserContext(sessionId, context) {
        try {
            await redisClient.hSet(`user_context:${sessionId}`, context);
            await redisClient.expire(`user_context:${sessionId}`, 24 * 60 * 60); // 24 hours
            logger.debug('User context stored', { 
                sessionId, 
                userId: context.userId,
                email: context.email,
                timestamp: context.lastActivity 
            });
        } catch (error) {
            logger.error('Failed to store user context:', {
                error: error.message,
                sessionId
            });
            throw error;
        }
    }

    static async getUserContext(sessionId) {
        try {
            const context = await redisClient.hGetAll(`user_context:${sessionId}`);
            logger.debug('User context retrieved', { 
                sessionId, 
                hasContext: !!context && Object.keys(context).length > 0
            });
            return context;
        } catch (error) {
            logger.error('Failed to get user context:', {
                error: error.message,
                sessionId
            });
            throw error;
        }
    }

    static async removeUserContext(sessionId) {
        try {
            await redisClient.del(`user_context:${sessionId}`);
            // Also remove the session from Redis
            await redisClient.del(`sess:${sessionId}`);
            logger.debug('User context and session removed', { sessionId });
        } catch (error) {
            logger.error('Failed to remove user context and session:', {
                error: error.message,
                sessionId
            });
            throw error;
        }
    }
}