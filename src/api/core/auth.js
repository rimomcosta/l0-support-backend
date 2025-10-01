// src/api/core/auth.js
import { AuthManagementService } from '../../services/authManagementService.js';
import { logger } from '../../services/logger.js';
import { sessionConfig } from '../../config/session.js';

export async function login(req, res) {
    try {
        const authService = new AuthManagementService();
        const result = await authService.initializeLogin(req);
        
        res.status(result.statusCode).json(result.success ? {
            authUrl: result.authUrl
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Login initialization failed', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        res.status(500).json({ error: 'Failed to initialize login' });
    }
}

export async function callback(req, res) {
    try {
        const authService = new AuthManagementService();
        const result = await authService.handleCallback(req);
        
        if (result.success) {
            res.redirect(result.redirectUrl);
        } else {
            res.status(result.statusCode).json({
                error: result.error
            });
        }
    } catch (error) {
        logger.error('Callback processing failed', {
            error: error.message,
            stack: error.stack,
            query: req.query,
            sessionId: req.sessionID
        });
        res.status(500).json({ error: 'Authentication failed' });
    }
}

export function getUser(req, res) {
    logger.debug('User session check', {
        timestamp: new Date().toISOString(),
        isAuthenticated: Boolean(req.session?.user),
        userId: req.session?.user?.id,
        sessionId: req.sessionID,
        cookies: req.headers.cookie
    });

    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(req.session.user);
}

export async function claimSession(req, res) {
    try {
        const authService = new AuthManagementService();
        const result = await authService.claimSession(req);
        
        res.status(result.statusCode).json(result.success ? {
            success: true,
            user: result.user
        } : {
            success: false,
            error: result.error
        });
    } catch (error) {
        logger.error('Session claim failed', {
            error: error.message,
            sessionId: req.sessionID
        });
        res.status(500).json({ success: false, error: 'Failed to claim session' });
    }
}

export async function logout(req, res) {
    try {
        const authService = new AuthManagementService();
        const result = await authService.logout(req);
        
        if (result.success) {
            res.clearCookie(sessionConfig.name, {
                path: '/',
                secure: sessionConfig.cookie.secure,
                httpOnly: sessionConfig.cookie.httpOnly,
                sameSite: sessionConfig.cookie.sameSite
            });
            res.json({ success: true });
        } else {
            res.status(result.statusCode).json({
                error: result.error
            });
        }
    } catch (error) {
        logger.error('Logout failed', {
            error: error.message,
            sessionId: req.sessionID
        });
        res.status(500).json({ error: 'Logout failed' });
    }
}

export async function sessionHealth(req, res) {
    try {
        const authService = new AuthManagementService();
        const result = await authService.checkSessionHealth(req);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error,
            code: result.code
        });
    } catch (error) {
        logger.error('Session health check failed', {
            error: error.message,
            sessionId: req.sessionID
        });
        res.status(500).json({ error: 'Session health check failed' });
    }
}

export async function extendSession(req, res) {
    try {
        const authService = new AuthManagementService();
        const result = await authService.extendSession(req);
        
        res.status(result.statusCode).json(result.success ? {
            success: true,
            user: result.user,
            message: result.message,
            configHash: result.configHash
        } : {
            error: result.error,
            code: result.code
        });
    } catch (error) {
        logger.error('Session extension failed', {
            error: error.message,
            sessionId: req.sessionID
        });
        res.status(500).json({ error: 'Session extension failed' });
    }
}

export async function refreshMockSession(req, res) {
    try {
        const authService = new AuthManagementService();
        const result = await authService.refreshMockSession(req);
        
        res.status(result.statusCode).json(result.success ? {
            success: true,
            user: result.user,
            message: result.message,
            configHash: result.configHash
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('Mock session refresh failed', {
            error: error.message,
            sessionId: req.sessionID
        });
        res.status(500).json({ error: 'Mock session refresh failed' });
    }
}