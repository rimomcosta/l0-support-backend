// src/api/core/auth.js
import { AuthService } from '../../services/authService.js';
import { oidcClient } from '../../services/oidcService.js';
import { logger } from '../../services/logger.js';
import { logActivity } from '../../services/activityLogger.js';
import jwt from 'jsonwebtoken';
import { sessionConfig } from '../../config/session.js';
import { getMockUserForSession, getConfigHash } from '../../config/mockUser.js';

export async function login(req, res) {
    try {
        if (!oidcClient) throw new Error('OIDC Client not initialized');

        const authParams = await AuthService.generateAuthParameters();
        
        // Store auth params in a new session
        req.session.auth = {
            ...authParams,
            returnTo: req.query.returnTo
        };

        await AuthService.saveSession(req.session);
        
        // Also store auth data in Redis using state as key for cross-domain access
        try {
            const redis = await import('../../services/redisService.js');
            const stateKey = `auth_state:${authParams.state}`;
            await redis.redisClient.setEx(stateKey, 300, JSON.stringify(req.session.auth)); // 5 minutes TTL
        } catch (redisError) {
            logger.error('Failed to store auth data in Redis:', redisError);
        }

        const authUrl = await AuthService.generateAuthUrl(authParams);
        
        logger.info('Auth flow initiated', {
            timestamp: new Date().toISOString(),
            sessionId: req.sessionID,
            hasAuthData: !!req.session?.auth,
            authKeys: req.session?.auth ? Object.keys(req.session.auth) : [],
            authUrl: authUrl,
            cookies: req.headers.cookie
        });
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
        logger.info('Starting callback process', {
            sessionId: req.sessionID,
            hasSession: !!req.session,
            hasAuthData: !!req.session?.auth,
            cookies: req.headers.cookie,
            userAgent: req.headers['user-agent'],
            url: req.url,
            method: req.method,
            headers: req.headers,
            query: req.query,
            body: req.body
        });
        
        // Manually extract callback parameters instead of using oidcClient.callbackParams
        const params = {
            code: req.query.code,
            state: req.query.state
        };

        logger.info('Callback params received', {
            params: params,
            hasCode: !!params.code,
            hasState: !!params.state,
            query: req.query
        });

        // Try to get auth data from session first
        let authData = req.session?.auth;
        
        // Always try to get fresh auth data from Redis using state parameter
        // This ensures we have the correct auth data for the current callback
        if (params.state) {
            try {
                const redis = await import('../../services/redisService.js');
                const stateKey = `auth_state:${params.state}`;
                const storedAuthData = await redis.redisClient.get(stateKey);
                if (storedAuthData) {
                    authData = JSON.parse(storedAuthData);
                    // Set the auth data back into the session so it's available for the rest of the flow
                    req.session.auth = authData;
                    // Clean up the temporary state data
                    await redis.redisClient.del(stateKey);
                }
            } catch (redisError) {
                logger.error('Failed to retrieve auth data from Redis:', redisError);
            }
        }
        
        if (!authData) {
            logger.error('No session auth data found', {
                sessionId: req.sessionID,
                sessionKeys: req.session ? Object.keys(req.session) : [],
                cookies: req.headers.cookie,
                allCookies: req.headers.cookie,
                state: params.state
            });
            throw new Error('No session auth data found');
        }

        const tokenSet = await AuthService.validateCallback(params, req.session.auth);
        await AuthService.validateToken(tokenSet.id_token);

        const decodedToken = jwt.decode(tokenSet.id_token);
        
        const userInfo = await AuthService.processUserInfo(decodedToken);
        
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
            email: userInfo.email,
            timestamp: new Date().toISOString()
        });

        logActivity.auth.login(user.user_id, userInfo.email, userInfo.userRole);

        const returnTo = req.session.auth.returnTo || `${process.env.CLIENT_ORIGIN}?auth=success`;
        delete req.session.auth.returnTo;

        // Store session data in Redis with state as key for cross-domain transfer
        try {
            const redis = await import('../../services/redisService.js');
            const stateKey = `session_transfer:${params.state}`;
            await redis.redisClient.setEx(stateKey, 300, JSON.stringify({
                user: req.session.user,
                tokens: req.session.tokens,
                sessionId: req.sessionID
            })); // 5 minutes TTL
            
            // Redirect with state parameter
            const separator = returnTo.includes('?') ? '&' : '?';
            res.redirect(`${returnTo}${separator}state=${params.state}`);
        } catch (error) {
            logger.error('Failed to store session transfer data:', error);
            res.redirect(returnTo);
        }

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
        const { state } = req.body;
        
        if (!state) {
            return res.status(400).json({ error: 'State parameter required' });
        }
        
        const stateKey = `session_transfer:${state}`;
        
        // Get session data from Redis
        const redis = await import('../../services/redisService.js');
        const sessionData = await redis.redisClient.get(stateKey);
        
        if (!sessionData) {
            return res.status(401).json({ error: 'Invalid or expired state' });
        }
        
        const { user, tokens, sessionId } = JSON.parse(sessionData);
        
        // Transfer session data to current session
        req.session.user = user;
        req.session.tokens = tokens;
        
        // Save the session
        await AuthService.saveSession(req.session);
        
        // Clean up the transfer data
        await redis.redisClient.del(stateKey);
        
        logger.info('Session claimed successfully', {
            newSessionId: req.sessionID,
            userEmail: user.email,
            originalSessionId: sessionId
        });
        
        res.json({ success: true, user });
        
    } catch (error) {
        logger.error('Session claim failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
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

export async function refreshMockSession(req, res) {
    try {
        const useOkta = process.env.USE_OKTA !== 'false';
        const isDevelopment = process.env.NODE_ENV !== 'production';
        
        // Only allow refresh in development with mock auth
        if (!isDevelopment || useOkta) {
            return res.status(403).json({ 
                error: 'Mock session refresh only available in development with USE_OKTA=false' 
            });
        }
        
        const oldUser = req.session?.user;
        const currentConfigHash = getConfigHash();
        
        // Force refresh the mock user session
        req.session.user = getMockUserForSession();
        
        await AuthService.saveSession(req.session);
        
        logger.info('Mock user session manually refreshed', {
            userId: req.session.user.id,
            email: req.session.user.email,
            isAdmin: req.session.user.isAdmin,
            isUser: req.session.user.isUser,
            oldConfigHash: oldUser?.configHash,
            newConfigHash: currentConfigHash,
            sessionId: req.sessionID
        });
        
        res.json({ 
            success: true, 
            user: req.session.user,
            message: 'Mock user session refreshed successfully',
            configHash: currentConfigHash
        });
        
    } catch (error) {
        logger.error('Mock session refresh failed:', error);
        res.status(500).json({ error: 'Failed to refresh mock session' });
    }
}