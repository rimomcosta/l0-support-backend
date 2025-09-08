// src/services/authManagementService.js
import { AuthService } from './authService.js';
import { oidcClient } from './oidcService.js';
import { logger } from './logger.js';
import { logActivity } from './activityLogger.js';
import jwt from 'jsonwebtoken';
import { sessionConfig } from '../config/session.js';
import { getMockUserForSession, getConfigHash } from '../config/mockUser.js';

export class AuthManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate OIDC client initialization
     * @returns {Object} - Validation result
     */
    validateOidcClient() {
        if (!oidcClient) {
            return {
                valid: false,
                error: 'OIDC Client not initialized'
            };
        }
        return { valid: true };
    }

    /**
     * Store auth data in Redis
     * @param {Object} authParams - Auth parameters
     * @param {Object} sessionAuth - Session auth data
     * @returns {Promise<boolean>} - Success status
     */
    async storeAuthDataInRedis(authParams, sessionAuth) {
        try {
            const redis = await import('./redisService.js');
            const stateKey = `auth_state:${authParams.state}`;
            await redis.redisClient.setEx(stateKey, 300, JSON.stringify(sessionAuth)); // 5 minutes TTL
            return true;
        } catch (redisError) {
            this.logger.error('Failed to store auth data in Redis:', redisError);
            return false;
        }
    }

    /**
     * Retrieve auth data from Redis
     * @param {string} state - State parameter
     * @returns {Promise<Object|null>} - Auth data or null
     */
    async retrieveAuthDataFromRedis(state) {
        try {
            const redis = await import('./redisService.js');
            const stateKey = `auth_state:${state}`;
            const storedAuthData = await redis.redisClient.get(stateKey);
            if (storedAuthData) {
                // Clean up the temporary state data
                await redis.redisClient.del(stateKey);
                return JSON.parse(storedAuthData);
            }
            return null;
        } catch (redisError) {
            this.logger.error('Failed to retrieve auth data from Redis:', redisError);
            return null;
        }
    }

    /**
     * Initialize login process
     * @param {Object} req - Express request object
     * @returns {Object} - Result with auth URL or error
     */
    async initializeLogin(req) {
        try {
            const validation = this.validateOidcClient();
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            const authParams = await AuthService.generateAuthParameters();
            
            // Store auth params in a new session
            req.session.auth = {
                ...authParams,
                returnTo: req.query.returnTo
            };

            await AuthService.saveSession(req.session);
            
            // Also store auth data in Redis using state as key for cross-domain access
            await this.storeAuthDataInRedis(authParams, req.session.auth);

            const authUrl = await AuthService.generateAuthUrl(authParams);
            
            this.logger.info('Auth flow initiated', {
                timestamp: new Date().toISOString(),
                sessionId: req.sessionID,
                hasAuthData: !!req.session?.auth,
                authKeys: req.session?.auth ? Object.keys(req.session.auth) : [],
                authUrl: authUrl,
                cookies: req.headers.cookie
            });

            return {
                success: true,
                authUrl,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Login initialization failed', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            return {
                success: false,
                error: 'Failed to initialize login',
                statusCode: 500
            };
        }
    }

    /**
     * Handle OIDC callback
     * @param {Object} req - Express request object
     * @returns {Object} - Result with redirect URL or error
     */
    async handleCallback(req) {
        try {
            this.logger.info('Starting callback process');
            
            // Manually extract callback parameters instead of using oidcClient.callbackParams
            const params = {
                code: req.query.code,
                state: req.query.state
            };

            this.logger.info('Callback params received', {
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
                const redisAuthData = await this.retrieveAuthDataFromRedis(params.state);
                if (redisAuthData) {
                    authData = redisAuthData;
                    // Set the auth data back into the session so it's available for the rest of the flow
                    req.session.auth = authData;
                }
            }
            
            if (!authData) {
                this.logger.error('No session auth data found', {
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

            this.logger.info('Authentication successful', {
                userId: user.user_id,
                email: userInfo.email,
                timestamp: new Date().toISOString()
            });

            logActivity.auth.login(user.user_id, userInfo.email, userInfo.userRole);

            const returnTo = req.session.auth.returnTo || `${process.env.CLIENT_ORIGIN}?auth=success`;
            delete req.session.auth.returnTo;

            // Store session data in Redis with state as key for cross-domain transfer
            try {
                const redis = await import('./redisService.js');
                const stateKey = `session_transfer:${params.state}`;
                await redis.redisClient.setEx(stateKey, 300, JSON.stringify({
                    user: req.session.user,
                    tokens: req.session.tokens,
                    sessionId: req.sessionID
                })); // 5 minutes TTL
                
                // Redirect with state parameter
                const separator = returnTo.includes('?') ? '&' : '?';
                return {
                    success: true,
                    redirectUrl: `${returnTo}${separator}state=${params.state}`,
                    statusCode: 200
                };
            } catch (error) {
                this.logger.error('Failed to store session transfer data:', error);
                return {
                    success: true,
                    redirectUrl: returnTo,
                    statusCode: 200
                };
            }
        } catch (error) {
            this.logger.error('Authentication failed', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            return {
                success: false,
                redirectUrl: `${process.env.CLIENT_ORIGIN}?auth=error&message=${encodeURIComponent(error.message)}`,
                statusCode: 500
            };
        }
    }

    /**
     * Claim session for user
     * @param {Object} req - Express request object
     * @returns {Object} - Result with user data or error
     */
    async claimSession(req) {
        try {
            const { state } = req.body;
            
            if (!state) {
                return {
                    success: false,
                    error: 'State parameter required',
                    statusCode: 400
                };
            }
            
            const stateKey = `session_transfer:${state}`;
            
            // Get session data from Redis
            const redis = await import('./redisService.js');
            const sessionData = await redis.redisClient.get(stateKey);
            
            if (!sessionData) {
                return {
                    success: false,
                    error: 'Invalid or expired state',
                    statusCode: 401
                };
            }
            
            const { user, tokens, sessionId } = JSON.parse(sessionData);
            
            // Transfer session data to current session
            req.session.user = user;
            req.session.tokens = tokens;
            
            // Save the session
            await AuthService.saveSession(req.session);
            
            // Clean up the transfer data
            await redis.redisClient.del(stateKey);
            
            this.logger.info('Session claimed successfully', {
                newSessionId: req.sessionID,
                userEmail: user.email,
                originalSessionId: sessionId
            });
            
            return {
                success: true,
                user,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Session claim failed:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Logout user
     * @param {Object} req - Express request object
     * @returns {Object} - Result with logout URL or error
     */
    async logout(req) {
        try {
            const userId = req.session?.user?.id;
            const userEmail = req.session?.user?.email;
            const sessionId = req.sessionID;

            this.logger.debug('Logout initiated', {
                timestamp: new Date().toISOString(),
                userId,
                sessionId
            });

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

            this.logger.info('Logout successful', {
                timestamp: new Date().toISOString(),
                userId,
                sessionId
            });

            // Log user logout activity
            if (userId && userEmail) {
                logActivity.auth.logout(userId, userEmail);
            }

            return {
                success: true,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Logout failed', {
                error: error.message,
                timestamp: new Date().toISOString(),
                userId: req.session?.user?.id,
                sessionId: req.sessionID
            });
            return {
                success: false,
                error: 'Logout failed',
                statusCode: 500
            };
        }
    }

    /**
     * Check session health
     * @param {Object} req - Express request object
     * @returns {Object} - Result with session status or error
     */
    async checkSessionHealth(req) {
        try {
            if (!req.session?.user) {
                return {
                    success: false,
                    error: 'Not authenticated',
                    code: 'SESSION_EXPIRED',
                    statusCode: 401
                };
            }

            // Calculate session timing information
            const now = Date.now();
            const sessionCreated = req.session.cookie.originalMaxAge ? 
                (now - (req.session.cookie.originalMaxAge - req.session.cookie.maxAge)) : 
                now;
            const sessionAge = now - sessionCreated;
            const timeRemaining = req.session.cookie.maxAge;
            const expiresAt = new Date(now + timeRemaining);

            this.logger.debug('Session health check', {
                userId: req.session.user.id,
                sessionAge: Math.floor(sessionAge / 1000),
                timeRemaining: Math.floor(timeRemaining / 1000),
                expiresAt: expiresAt.toISOString()
            });

            return {
                success: true,
                data: {
                    isValid: true,
                    user: req.session.user,
                    sessionAge,
                    timeRemaining,
                    expiresAt: expiresAt.toISOString(),
                    isNearExpiry: timeRemaining < 30 * 60 * 1000, // Less than 30 minutes
                    warningThreshold: 30 * 60 * 1000 // 30 minutes in milliseconds
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Session health check failed:', {
                error: error.message,
                sessionId: req.sessionID
            });
            return {
                success: false,
                error: 'Session check failed',
                code: 'SESSION_CHECK_ERROR',
                statusCode: 500
            };
        }
    }

    /**
     * Extend session
     * @param {Object} req - Express request object
     * @returns {Object} - Result with success or error
     */
    async extendSession(req) {
        try {
            if (!req.session?.user) {
                return {
                    success: false,
                    error: 'Not authenticated',
                    code: 'SESSION_EXPIRED',
                    statusCode: 401
                };
            }

            const useOkta = process.env.USE_OKTA !== 'false';
            const isDevelopment = process.env.NODE_ENV !== 'production';
            
            if (useOkta) {
                // For Okta sessions, we need to refresh the token
                // This would typically involve calling Okta's token refresh endpoint
                // For now, we'll just regenerate the session with a new expiry
                req.session.cookie.maxAge = sessionConfig.cookie.maxAge;
                await AuthService.saveSession(req.session);
                
                this.logger.info('Okta session extended', {
                    userId: req.session.user.id,
                    sessionId: req.sessionID
                });
                
                return {
                    success: true,
                    user: req.session.user,
                    message: 'Session extended successfully',
                    statusCode: 200
                };
            } else {
                // For mock sessions in development, refresh the mock user
                const oldUser = req.session?.user;
                const currentConfigHash = getConfigHash();
                
                // Force refresh the mock user session
                req.session.user = getMockUserForSession();
                req.session.cookie.maxAge = sessionConfig.cookie.maxAge;
                
                await AuthService.saveSession(req.session);
                
                this.logger.info('Mock user session extended', {
                    userId: req.session.user.id,
                    email: req.session.user.email,
                    isAdmin: req.session.user.isAdmin,
                    isUser: req.session.user.isUser,
                    oldConfigHash: oldUser?.configHash,
                    newConfigHash: currentConfigHash,
                    sessionId: req.sessionID
                });
                
                return {
                    success: true,
                    user: req.session.user,
                    message: 'Mock user session extended successfully',
                    configHash: currentConfigHash,
                    statusCode: 200
                };
            }
        } catch (error) {
            this.logger.error('Session extension failed:', error);
            return {
                success: false,
                error: 'Failed to extend session',
                statusCode: 500
            };
        }
    }

    /**
     * Refresh mock session
     * @param {Object} req - Express request object
     * @returns {Object} - Result with user data or error
     */
    async refreshMockSession(req) {
        try {
            const useOkta = process.env.USE_OKTA !== 'false';
            const isDevelopment = process.env.NODE_ENV !== 'production';
            
            // Only allow refresh in development with mock auth
            if (!isDevelopment || useOkta) {
                return {
                    success: false,
                    error: 'Mock session refresh only available in development with USE_OKTA=false',
                    statusCode: 403
                };
            }
            
            const oldUser = req.session?.user;
            const currentConfigHash = getConfigHash();
            
            // Force refresh the mock user session
            req.session.user = getMockUserForSession();
            
            await AuthService.saveSession(req.session);
            
            this.logger.info('Mock user session manually refreshed', {
                userId: req.session.user.id,
                email: req.session.user.email,
                isAdmin: req.session.user.isAdmin,
                isUser: req.session.user.isUser,
                oldConfigHash: oldUser?.configHash,
                newConfigHash: currentConfigHash,
                sessionId: req.sessionID
            });
            
            return {
                success: true,
                user: req.session.user,
                message: 'Mock user session refreshed successfully',
                configHash: currentConfigHash,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Mock session refresh failed:', error);
            return {
                success: false,
                error: 'Failed to refresh mock session',
                statusCode: 500
            };
        }
    }
}
