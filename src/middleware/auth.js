//src/middleware/auth.js
import { logger } from '../services/logger.js';
import { SessionService } from '../services/sessionService.js';
import { getMockUserForSession, getConfigHash } from '../config/mockUser.js';

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
    const useOkta = process.env.USE_OKTA !== 'false'; // Default to true unless explicitly set to false
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    // If USE_OKTA=false in development, always use mock auth (no login page needed)
    if (isDevelopment && !useOkta) {
        const currentConfigHash = getConfigHash();
        
        // Check if session doesn't exist or if config has changed
        if (!req.session?.user || req.session.user.configHash !== currentConfigHash) {
            req.session.user = getMockUserForSession();
            
            if (req.session.user.configHash !== currentConfigHash) {
                logger.info('Development mode: Refreshed mock user session due to config change (USE_OKTA=false)', {
                    userId: req.session.user.id,
                    email: req.session.user.email,
                    isAdmin: req.session.user.isAdmin,
                    isUser: req.session.user.isUser,
                    oldConfigHash: req.session.user.configHash,
                    newConfigHash: currentConfigHash
                });
            } else {
                logger.info('Development mode: Created mock admin session (USE_OKTA=false)', {
                    userId: req.session.user.id,
                    email: req.session.user.email
                });
            }
        }
        return next();
    }
    
    // For USE_OKTA=true or production: require real authentication, no fallbacks
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