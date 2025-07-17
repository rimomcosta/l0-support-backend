// src/services/authService.js
import { generators } from 'openid-client';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { oidcClient } from './oidcService.js';
import { ApiTokenService } from './apiTokenService.js';
import { logger } from './logger.js';
import { cleanupSession } from '../services/redisService.js';
import { EncryptionService } from './encryptionService.js';
import session from 'express-session';

export class AuthService {
    static async generateAuthParameters() {
        const state = generators.state();
        const nonce = generators.nonce();
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);

        return {
            state,
            nonce,
            codeVerifier,
            codeChallenge
        };
    }

    static async generateAuthUrl(authParams) {
        if (!oidcClient) throw new Error('OIDC Client not initialized');

        return oidcClient.authorizationUrl({
            scope: 'openid profile email groups',
            state: authParams.state,
            nonce: authParams.nonce,
            code_challenge: authParams.codeChallenge,
            code_challenge_method: 'S256'
        });
    }

    static async validateCallback(params, sessionAuth) {
        if (!oidcClient) throw new Error('OIDC Client not initialized');
        if (!sessionAuth) throw new Error('No session auth data found');
        if (params.state !== sessionAuth.state) throw new Error('State mismatch');

        const tokenSet = await oidcClient.callback(
            process.env.OKTA_REDIRECT_URI,
            params,
            {
                state: sessionAuth.state,
                nonce: sessionAuth.nonce,
                code_verifier: sessionAuth.codeVerifier
            }
        );

        return tokenSet;
    }

    static async validateToken(idToken) {
        const response = await fetch(`${process.env.OKTA_ISSUER}/oauth2/v1/introspect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                client_id: process.env.OKTA_CLIENT_ID,
                client_secret: process.env.OKTA_CLIENT_SECRET,
                token: idToken,
                token_type_hint: 'id_token'
            })
        });

        const introspectData = await response.json();
        if (!introspectData.active) {
            logger.error('Token validation failed: Token not active');
            throw new Error('Invalid token');
        }
        return introspectData;
    }

    static async processUserInfo(decodedToken) {
        const userInfo = {
            email: decodedToken.email,
            name: decodedToken.name,
            groups: decodedToken.groups || []
        };

        // Determine user permissions based on groups
        let isAdmin, isUser, userRole;
        if (process.env.NODE_ENV === 'development' && process.env.USE_OKTA === 'false') {
            // In development with mock auth, use mock user config
            const { getMockUserForSession } = await import('../config/mockUser.js');
            const mockUser = getMockUserForSession();
            isAdmin = mockUser.isAdmin;
            isUser = mockUser.isUser;
            userRole = mockUser.role;
            logger.info('Development mode with mock auth: Using mock user permissions', {
                email: userInfo.email,
                isAdmin,
                isUser,
                userRole
            });
        } else {
            // Normal Okta authentication logic
            isAdmin = userInfo.groups.includes('GRP-L0SUPPORT-ADMIN');
            isUser = userInfo.groups.includes('GRP-L0SUPPORT-USER');
            userRole = isAdmin ? 'admin' : (isUser ? 'user' : 'guest');
        }

        return {
            ...userInfo,
            isAdmin,
            isUser,
            userRole
        };
    }

    static async getOrCreateUser(userInfo) {
        let user = await ApiTokenService.getUserByEmail(userInfo.email);

        if (!user) {
            logger.info('Creating new user', {
                email: userInfo.email,
                role: userInfo.userRole
            });

            // Generate salt here
            const salt = EncryptionService.generateSalt();

            user = {
                user_id: uuidv4(),
                username: userInfo.name,
                email: userInfo.email,
                api_token: null, // API token is null initially
                salt: salt, // Store the salt
                role: userInfo.userRole
            };

            await ApiTokenService.createUser(user);
        }

        return user;
    }

    static async logout(sessionId) {
        try {
            // Cleanup Redis session
            await cleanupSession(sessionId);
            logger.info('User session cleaned up successfully', { sessionId });
        } catch (error) {
            logger.error('Failed to cleanup user session', {
                error: error.message,
                sessionId
            });
            throw error;
        }
    }

    static async saveSession(session) {
        return new Promise((resolve, reject) => {
            session.save((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}