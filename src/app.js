// src/app.js
import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { userContextMiddleware } from './middleware/userContext.js';
import { logger } from './services/logger.js';
import { initializeRedis, createSessionStore } from './services/redisService.js';
import { initializeOIDCClient } from './services/oidcService.js';
import { errorHandler } from './middleware/errorHandler.js';
import { corsConfig } from './config/cors.js';
import { sessionConfig } from './config/session.js';
import routes from './routes.js';
import { initializeTables } from './config/initDatabase.js';
// import path from 'path';
// import { fileURLToPath } from 'url';

dotenv.config();
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

export async function initializeApp() {
    try {
        logger.info('Initializing application', { timestamp: new Date().toISOString() });
        const app = express();

        // Initialize core services
        await initializeRedis();
        await initializeOIDCClient();
        await initializeTables();

        // Middlewares and configurations
        app.set('trust proxy', 1);
        app.use(express.json({ limit: '50mb' })); // Increased from default 100kb to 50mb for large message inputs
        app.use(cookieParser());
        app.use(cors(corsConfig));

        // Create and configure session parser once
        const redisStore = createSessionStore();
        const sessionParser = session({ store: redisStore, ...sessionConfig });

        // // Serve the React build
        // app.use(express.static(path.join(__dirname, '../../frontend/build')));

        // Use the sessionParser in app
        app.use(sessionParser);
        app.use(userContextMiddleware);

        routes(app);

        // // If you want client-side routing, serve index.html for all non-API routes
        // app.get('*', (req, res) => {
        //     res.sendFile(path.join(__dirname, '../../frontend/build', 'index.html'));
        // });

        app.use(errorHandler);

        logger.info('Application initialization complete', {
            timestamp: new Date().toISOString(),
            nodeEnv: process.env.NODE_ENV
        });

        // Return the app and the sessionParser for reuse
        return { app, sessionParser };
    } catch (error) {
        logger.error('Application initialization failed:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            nodeEnv: process.env.NODE_ENV
        });
        console.error('Application initialization failed:', error);
        throw error;
    }
}
