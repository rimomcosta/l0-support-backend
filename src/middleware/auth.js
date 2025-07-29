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

export function requireAdmin(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const useOkta = process.env.USE_OKTA !== 'false';
    const isDevelopment = process.env.NODE_ENV !== 'production';

    // In development mode with USE_OKTA=false, all users are admin
    if (isDevelopment && !useOkta) {
        return next();
    }

    // Check if user has admin group from Okta
    const isAdmin = req.session.user.groups?.includes('GRP-L0SUPPORT-ADMIN');
    
    if (!isAdmin) {
        return res.status(403).json({ 
            error: 'Access denied. Admin privileges required.',
            code: 'ADMIN_REQUIRED'
        });
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
    

    
    // SECURITY: If USE_OKTA=true, automatically invalidate any existing mock sessions
    if (useOkta && req.session?.user?.id === 'dev-admin-user') {
        logger.warn('Security: Invalidating mock user session due to USE_OKTA=true', {
            sessionUser: req.session.user.id,
            sessionEmail: req.session.user.email,
            sessionId: req.sessionID,
            path: req.path
        });
        
        // Destroy the session containing mock user
        req.session.destroy((err) => {
            if (err) {
                logger.error('Failed to destroy mock session:', err);
            }
        });
        
        // Clear the session cookie
        res.clearCookie('sessionId', {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        // Return 401 to force re-authentication
        return res.status(401).json({ 
            error: 'Authentication mode changed. Please authenticate with Okta.',
            code: 'AUTH_MODE_CHANGED',
            requiresOkta: true
        });
    }
    
    // If USE_OKTA=false in development, allow mock auth (no login page needed)
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
        
        // In development mode with USE_OKTA=false, ensure all users have admin privileges
        if (req.session?.user) {
            req.session.user.isAdmin = true;
            req.session.user.groups = ['GRP-L0SUPPORT-ADMIN', 'GRP-L0SUPPORT-USER'];
            req.session.user.role = 'admin';
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