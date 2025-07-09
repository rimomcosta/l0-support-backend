// src/api/core/auth.js
import { AuthService } from '../../services/authService.js';
import { oidcClient } from '../../services/oidcService.js';
import { logger } from '../../services/logger.js';
import { logActivity } from '../../services/activityLogger.js';
import jwt from 'jsonwebtoken';
import { sessionConfig } from '../../config/session.js';

export async function login(req, res) {
    try {
        if (!oidcClient) throw new Error('OIDC Client not initialized');

        const authParams = await AuthService.generateAuthParameters();
        
        req.session.auth = {
            ...authParams,
            returnTo: req.query.returnTo
        };

        await AuthService.saveSession(req.session);

        logger.debug('Auth flow initiated', {
            timestamp: new Date().toISOString()
        });

        const authUrl = await AuthService.generateAuthUrl(authParams);
        res.json({ authUrl });
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
        logger.info('Starting callback process');
        const params = oidcClient.callbackParams(req);

        const tokenSet = await AuthService.validateCallback(params, req.session.auth);
        await AuthService.validateToken(tokenSet.id_token);

        const decodedToken = jwt.decode(tokenSet.id_token);
        const userInfo = AuthService.processUserInfo(decodedToken);
        const user = await AuthService.getOrCreateUser(userInfo);

        req.session.user = {
            id: user.user_id,
            email: userInfo.email,
            name: userInfo.name,
            role: userInfo.userRole,
            isAdmin: userInfo.isAdmin,
            isUser: userInfo.isUser,
            groups: userInfo.groups
        };

        req.session.tokens = {
            access_token: tokenSet.access_token,
            id_token: tokenSet.id_token
        };

        await AuthService.saveSession(req.session);

        logger.info('Authentication successful', {
            userId: user.user_id,
            timestamp: new Date().toISOString()
        });

        // Log user login activity
        logActivity.auth.login(user.user_id, userInfo.email, userInfo.userRole);

        const returnTo = req.session.auth.returnTo || `${process.env.CLIENT_ORIGIN}?auth=success`;
        delete req.session.auth.returnTo;

        res.redirect(returnTo);
    } catch (error) {
        logger.error('Authentication failed', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        res.redirect(`${process.env.CLIENT_ORIGIN}?auth=error&message=${encodeURIComponent(error.message)}`);
    }
}

export function getUser(req, res) {
    logger.debug('User session check', {
        timestamp: new Date().toISOString(),
        isAuthenticated: Boolean(req.session?.user),
        userId: req.session?.user?.id
    });

    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(req.session.user);
}

export async function logout(req, res) {
    const userId = req.session?.user?.id;
    const userEmail = req.session?.user?.email;
    const sessionId = req.sessionID;

    logger.debug('Logout initiated', {
        timestamp: new Date().toISOString(),
        userId,
        sessionId
    });

    try {
        // Close any active WebSocket connections for this user
        if (global.wss) {
            global.wss.clients.forEach(client => {
                if (client.userID === userId) {
                    client.terminate();
                }
            });
        }

        // Destroy Express session
        await new Promise((resolve, reject) => {
            req.session.destroy((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Cleanup session and Redis
        await AuthService.logout(sessionId);

        logger.info('Logout successful', {
            timestamp: new Date().toISOString(),
            userId,
            sessionId
        });

        // Log user logout activity
        if (userId && userEmail) {
            logActivity.auth.logout(userId, userEmail);
        }

        res.clearCookie(sessionConfig.name, {
            path: '/',
            secure: sessionConfig.cookie.secure,
            httpOnly: sessionConfig.cookie.httpOnly,
            sameSite: sessionConfig.cookie.sameSite
        });
        res.json({ success: true });
    } catch (error) {
        logger.error('Logout failed', {
            error: error.message,
            timestamp: new Date().toISOString(),
            userId,
            sessionId
        });
        res.status(500).json({ error: 'Logout failed' });
    }
}

export async function sessionHealth(req, res) {
    try {
        if (!req.session?.user) {
            return res.status(401).json({ 
                error: 'Not authenticated',
                code: 'SESSION_EXPIRED'
            });
        }

        // Calculate session timing information
        const now = Date.now();
        const sessionCreated = req.session.cookie.originalMaxAge ? 
            (now - (req.session.cookie.originalMaxAge - req.session.cookie.maxAge)) : 
            now;
        const sessionAge = now - sessionCreated;
        const timeRemaining = req.session.cookie.maxAge;
        const expiresAt = new Date(now + timeRemaining);

        logger.debug('Session health check', {
            userId: req.session.user.id,
            sessionAge: Math.floor(sessionAge / 1000),
            timeRemaining: Math.floor(timeRemaining / 1000),
            expiresAt: expiresAt.toISOString()
        });

        res.json({
            isValid: true,
            user: req.session.user,
            sessionAge,
            timeRemaining,
            expiresAt: expiresAt.toISOString(),
            isNearExpiry: timeRemaining < 30 * 60 * 1000, // Less than 30 minutes
            warningThreshold: 30 * 60 * 1000 // 30 minutes in milliseconds
        });
    } catch (error) {
        logger.error('Session health check failed:', {
            error: error.message,
            sessionId: req.sessionID
        });
        res.status(500).json({ 
            error: 'Session check failed',
            code: 'SESSION_CHECK_ERROR'
        });
    }
}