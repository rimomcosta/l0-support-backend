// src/api/core/auth.js
import { oidcClient } from '../../services/oidcService.js';
import { generators } from 'openid-client';
import { logger } from '../../services/logger.js';
import { v4 as uuidv4 } from 'uuid'; // Import uuid
import { ApiTokenService } from '../../services/apiTokenService.js'; // Import ApiTokenService
import jwt from 'jsonwebtoken';

// export let oidcClient = null;

export async function initializeOIDCClient() {
    try {
        logger.info('Initializing OIDC client...');

        const issuer = await Issuer.discover(process.env.OKTA_ISSUER);
        oidcClient = new issuer.Client({
            client_id: process.env.OKTA_CLIENT_ID,
            client_secret: process.env.OKTA_CLIENT_SECRET,
            redirect_uris: [process.env.OKTA_REDIRECT_URI],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic'
        });

        logger.info('OIDC client initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize OIDC client:', error);
        throw error;
    }
}

// src/api/core/auth.js
export async function login(req, res) {
    try {
        if (!oidcClient) throw new Error('OIDC Client not initialized');

        const state = generators.state();
        const nonce = generators.nonce();
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);

        req.session.auth = {
            state,
            nonce,
            codeVerifier,
            codeChallenge,
            returnTo: req.query.returnTo
        };

        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        logger.debug('Auth flow initiated', {
            timestamp: new Date().toISOString(),
            hasRequiredParams: Boolean(state && nonce && codeChallenge)
        });

        // According to documentation, using proper scopes
        const authUrl = oidcClient.authorizationUrl({
            scope: 'openid profile email groups',
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
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
        logger.info('Step 1 ===> Starting callback process'+JSON.stringify(req.query));
        if (!oidcClient) throw new Error('OIDC Client not initialized');

        logger.info('Step 2 ===> Validating callback parameters');
        const params = oidcClient.callbackParams(req);

        if (!req.session?.auth) {
            logger.error('Step 3 ===> Session validation failed: NO_AUTH_DATA');
            throw new Error('No session auth data found');
        }

        logger.info('Step 4 ===> Validating state parameter');
        if (params.state !== req.session.auth.state) {
            logger.error('Step 4 ===> State validation failed: STATE_MISMATCH');
            throw new Error('State mismatch');
        }

        logger.info('Step 5 ===> Exchanging code for tokens');
        const tokenSet = await oidcClient.callback(
            process.env.OKTA_REDIRECT_URI,
            params,
            {
                state: req.session.auth.state,
                nonce: req.session.auth.nonce,
                code_verifier: req.session.auth.codeVerifier
            }
        );

        // Token Validation using /introspect endpoint as per documentation
        logger.info('Step 6 ===> Validating ID token using introspect endpoint');
        const introspectResponse = await fetch(`${process.env.OKTA_ISSUER}/oauth2/v1/introspect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                client_id: process.env.OKTA_CLIENT_ID,
                client_secret: process.env.OKTA_CLIENT_SECRET,
                token: tokenSet.id_token,
                token_type_hint: 'id_token'
            })
        });

        const introspectData = await introspectResponse.json();

        if (!introspectData.active) {
            logger.error('Step 6 ===> Token validation failed: Token not active');
            throw new Error('Invalid token');
        }

        logger.info('Step 7 ===> Token validation successful', {
            tokenStatus: 'Valid',
            sub: introspectData.sub
        });

        // Decode the ID token
        const decodedToken = jwt.decode(tokenSet.id_token);
console.log('decodedToken=====>'+JSON.stringify(decodedToken, null, 2));
        logger.info('Step 8 ===> Fetching user info from ID token');
        const userInfo = {
          email: decodedToken.email,
          name: decodedToken.name,
          groups: decodedToken.groups || []
        };
        console.log('userInfo=====>'+JSON.stringify(userInfo, null, 2));
        logger.info('Step 9 ===> User info received', {
            email: userInfo.email,
            name: userInfo.name
        });

        // Determine user role based on groups
        const isAdmin = userInfo.groups.includes('GRP-L0SUPPORT-ADMIN');
        const isUser = userInfo.groups.includes('GRP-L0SUPPORT-USER');
        const userRole = isAdmin ? 'admin' : (isUser ? 'user' : 'guest');

        logger.info('Step 10 ===> User role determined', {
            role: userRole,
            isAdmin,
            isUser,
            groups: userInfo.groups
        });

        let user = await ApiTokenService.getUserByEmail(userInfo.email);

        if (!user) {
            logger.info('Step 11 ===> Creating new user', {
                email: userInfo.email,
                role: userRole
            });
            const newUserId = uuidv4();
            user = {
                user_id: newUserId,
                username: userInfo.name,
                email: userInfo.email,
                api_token: '',
                role: userRole
            };

            await ApiTokenService.createUser(user);
        }

        logger.info('Step 12 ===> Setting session data', {
            userId: user.user_id,
            role: userRole
        });

        req.session.user = {
            id: user.user_id,
            email: userInfo.email,
            name: userInfo.name,
            role: userRole,
            isAdmin,
            isUser,
            groups: userInfo.groups || []
        };

        req.session.tokens = {
            access_token: tokenSet.access_token,
            id_token: tokenSet.id_token
        };

        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        logger.info('Step 13 ===> Authentication successful', {
            userId: user.user_id,
            email: userInfo.email,
            role: userRole
        });

        const returnTo = req.session.auth.returnTo || `${process.env.CLIENT_ORIGIN}?auth=success`;
        delete req.session.auth.returnTo;

        res.redirect(returnTo);
    } catch (error) {
        logger.error('Authentication failed', {
            error: error.message,
            stack: error.stack,
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
        userRole: req.session?.user?.role,
        isAdmin: req.session?.user?.isAdmin,
        isUser: req.session?.user?.isUser
    });

    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(req.session.user);
}

export function logout(req, res) {
    const userId = req.session?.user?.id;

    logger.debug('Logout initiated', {
        timestamp: new Date().toISOString(),
        userId
    });

    req.session.destroy((err) => {
        if (err) {
            logger.error('Logout failed', {
                error: err.message,
                timestamp: new Date().toISOString(),
                userId
            });
            return res.status(500).json({ error: 'Logout failed' });
        }

        logger.info('Logout successful', {
            timestamp: new Date().toISOString(),
            userId
        });

        res.clearCookie('sessionId', {
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'none'
        });
        res.json({ success: true });
    });
}