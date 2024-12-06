import { oidcClient } from '../../services/oidcService.js';
import { generators } from 'openid-client';
import { logger } from '../../services/logger.js';

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

        const authUrl = oidcClient.authorizationUrl({
            scope: 'openid profile email',
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
        if (!oidcClient) throw new Error('OIDC Client not initialized');

        // Log only non-sensitive callback information
        logger.debug('Auth callback received', {
            timestamp: new Date().toISOString(),
            hasState: Boolean(req.query.state),
            hasCode: Boolean(req.query.code),
            hasSession: Boolean(req.session),
            hasAuthData: Boolean(req.session?.auth)
        });

        const params = oidcClient.callbackParams(req);

        if (!req.session) {
            logger.error('Session validation failed', {
                reason: 'NO_SESSION',
                timestamp: new Date().toISOString()
            });
            throw new Error('No session found');
        }

        if (!req.session.auth) {
            logger.error('Session validation failed', {
                reason: 'NO_AUTH_DATA',
                timestamp: new Date().toISOString()
            });
            throw new Error('No session auth data found');
        }

        if (params.state !== req.session.auth.state) {
            logger.error('Session validation failed', {
                reason: 'STATE_MISMATCH',
                timestamp: new Date().toISOString()
            });
            throw new Error('State mismatch');
        }

        const tokenSet = await oidcClient.callback(
            process.env.OKTA_REDIRECT_URI,
            params,
            {
                state: req.session.auth.state,
                nonce: req.session.auth.nonce,
                code_verifier: req.session.auth.codeVerifier
            }
        );

        const userInfo = await oidcClient.userinfo(tokenSet.access_token);

        req.session.user = {
            id: userInfo.sub,
            email: userInfo.email,
            name: userInfo.name
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

        logger.info('Authentication successful', {
            timestamp: new Date().toISOString(),
            userId: userInfo.sub
        });

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