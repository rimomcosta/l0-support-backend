import { Issuer } from 'openid-client';
import { logger } from './logger.js';

export let oidcClient = null;

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