import dotenv from 'dotenv';
import { logger } from './logger.js';
import { initializeApp } from '../app.js';

dotenv.config();

const port = process.env.PORT || 4000;

initializeApp()
    .then((app) => {
        app.listen(port, () => {
            logger.info(`Server running on port ${port}`);
            logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger.debug('Server configuration:', {
                clientOrigin: process.env.CLIENT_ORIGIN,
                apiUrl: process.env.REACT_APP_API_URL,
                oktaRedirectUri: process.env.OKTA_REDIRECT_URI
            });
        });
    })
    .catch((error) => {
        logger.error('Server initialization failed:', error);
        process.exit(1);
    });