//src/middleware/userContext.js
import { logger } from '../services/logger.js';
import { SessionService } from '../services/sessionService.js';

export async function userContextMiddleware(req, res, next) {
    try {
        if (req.session?.user) {
            // Store user context in request
            req.userContext = {
                userId: req.session.user.id,
                sessionId: req.sessionID,
                email: req.session.user.email
            };

            // Store extended context in Redis
            await SessionService.storeUserContext(req.sessionID, {
                userId: req.session.user.id,
                email: req.session.user.email,
                lastActivity: new Date().toISOString()
            });

            // Enhance logger with user context
            logger.defaultMeta = {
                userId: req.session.user.id,
                sessionId: req.sessionID
            };
        }
        next();
    } catch (error) {
        logger.error('User context middleware error:', {
            error: error.message,
            sessionId: req.sessionID
        });
        next(error);
    }
}