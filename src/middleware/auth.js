//src/middleware/auth.js
import { logger } from '../services/logger.js';
import { SessionService } from '../services/sessionService.js';

export function requireAuth(req, res, next) {
    if (!req.session.user) {
        logger.debug('Unauthorized access attempt:', {
            path: req.path,
            method: req.method,
            sessionID: req.sessionID
        });
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

export function sessionDebug(req, res, next) {
    logger.debug('Session Debug:', {
        sessionID: req.sessionID,
        hasSession: !!req.session,
        cookies: req.cookies,
        url: req.url
    });
    next();
}

export function conditionalAuth(req, res, next) {
    console.log('=== CONDITIONAL AUTH CHECK ===', {
        env: process.env.NODE_ENV,
        path: req.path,
        params: req.params,
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        userId: req.session?.user?.id
    });
    
    if (process.env.NODE_ENV !== 'production') {
        // In development mode, create a mock admin session if none exists
        if (!req.session?.user) {
            req.session.user = {
                id: 'dev-admin-user',
                email: 'dev-admin@example.com',
                name: 'Development Admin',
                role: 'admin',
                isAdmin: true,
                isUser: true,
                groups: ['GRP-L0SUPPORT-ADMIN', 'GRP-L0SUPPORT-USER']
            };
            
            logger.info('Development mode: Created mock admin session', {
                userId: req.session.user.id,
                email: req.session.user.email
            });
        }
        return next();
    }
    return requireAuth(req, res, next);
}

// Add this new function
export async function verifySession(req) {
    try {
        if (!req.session?.user) {
            return false;
        }

        const userContext = await SessionService.getUserContext(req.sessionID);
        if (!userContext || !userContext.userId) {
            return false;
        }

        return true;
    } catch (error) {
        logger.error('Session verification failed:', {
            error: error.message,
            sessionId: req.sessionID
        });
        return false;
    }
}