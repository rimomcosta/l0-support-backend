import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import cors from 'cors';
import cookieParser from 'cookie-parser';

// Services
import { logger } from './services/logger.js';
import { initializeRedis, createSessionStore } from './services/redisService.js';
import { initializeOIDCClient } from './services/oidcService.js';

// Middleware and configurations
import { errorHandler } from './middleware/errorHandler.js';
import { corsConfig } from './config/cors.js';
import { sessionConfig } from './config/session.js';
import routes from './routes.js';

dotenv.config();

export async function initializeApp() {
    try {
        // Start initialization with performance mark
        logger.info('Initializing application', { timestamp: new Date().toISOString() });
        const app = express();

        // Initialize core services - These must complete before proceeding with middleware setup
        await initializeRedis();
        await initializeOIDCClient(); // For Okta authentication

        // Middlewares and configurations
        app.set('trust proxy', 1);  // Required for secure cookies behind a proxy
        app.use(express.json());    // Parse JSON request bodies
        app.use(cookieParser());    // Parse Cookie header and populate req.cookies
        app.use(cors(corsConfig));  // Handle Cross-Origin Resource Sharing

        // Session configuration with Redis backend
        const redisStore = createSessionStore();
        app.use(session({ store: redisStore, ...sessionConfig }));

        routes(app);

        // Global error handling middleware
        app.use(errorHandler);

        logger.info('Application initialization complete', {
            timestamp: new Date().toISOString(),
            nodeEnv: process.env.NODE_ENV
        });

        return app;
    } catch (error) {
        // Log initialization failure with full context
        logger.error('Application initialization failed:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            nodeEnv: process.env.NODE_ENV
        });
        throw error;  // Re-throw to be handled by the caller
    }
}