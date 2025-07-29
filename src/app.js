// src/app.js
import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { userContextMiddleware } from './middleware/userContext.js';
import { trackUserActivity } from './middleware/activityTracking.js';
import { logger } from './services/logger.js';
import { initializeRedis, createSessionStore } from './services/redisService.js';
import { initializeOIDCClient } from './services/oidcService.js';
import { errorHandler } from './middleware/errorHandler.js';
import { corsConfig } from './config/cors.js';
import { sessionConfig } from './config/session.js';
import { initializeElasticsearch } from './config/elasticsearch.js';
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
        await initializeElasticsearch();

        // Middlewares and configurations
        app.set('trust proxy', 1);
        app.use(express.json({ limit: '50mb' })); // Increased from default 100kb to 50mb for large message inputs
        app.use(cookieParser());
        
        // Custom CORS middleware to handle ngrok tunnel issues after system sleep (development only)
        if (process.env.NODE_ENV !== 'production') {
            app.use((req, res, next) => {
                const origin = req.headers.origin;
                
                // Handle ngrok tunnel CORS issues specifically
                if (origin && origin.includes('.ngrok.io')) {
                    res.header('Access-Control-Allow-Origin', origin);
                    res.header('Access-Control-Allow-Credentials', 'true');
                    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
                    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning, Origin, Accept, Cookie, x-api-token-password, X-Requested-With, Access-Control-Request-Method, Access-Control-Request-Headers');
                    res.header('Access-Control-Expose-Headers', 'Set-Cookie');
                    res.header('Access-Control-Max-Age', '86400');
                    
                    // Handle preflight requests
                    if (req.method === 'OPTIONS') {
                        logger.debug('Handling preflight request for ngrok origin', { origin, method: req.method, path: req.path });
                        return res.status(204).end();
                    }
                }
                
                next();
            });
        }
        
        app.use(cors(corsConfig));

        // Create and configure session parser once
        const redisStore = createSessionStore();
        const sessionParser = session({ store: redisStore, ...sessionConfig });

        // // Serve the React build
        // app.use(express.static(path.join(__dirname, '../../frontend/build')));

        // Use the sessionParser in app
        app.use(sessionParser);
        app.use(userContextMiddleware);
        
        // Add comprehensive activity tracking middleware
        app.use(trackUserActivity);
        
        // In development mode with USE_OKTA=false, apply conditional auth to all routes
        if (process.env.NODE_ENV !== 'production' && process.env.USE_OKTA === 'false') {
            const { conditionalAuth } = await import('./middleware/auth.js');
            app.use(conditionalAuth);
        }

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
