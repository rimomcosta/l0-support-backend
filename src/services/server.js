// src/services/server.js
import dotenv from 'dotenv';
import { logger } from './logger.js';
import { initializeApp } from '../app.js';
import { WebSocketService } from './webSocketService.js';

dotenv.config();

const port = process.env.PORT || 4000;

initializeApp()
    .then((app) => {
        // Create HTTP server instance first
        const server = app.listen(port, () => {
            logger.info(`Server running on port ${port}`);
            logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger.debug('Server configuration:', {
                clientOrigin: process.env.CLIENT_ORIGIN,
                apiUrl: process.env.REACT_APP_API_URL,
                oktaRedirectUri: process.env.OKTA_REDIRECT_URI
            });
        });

        try {
            // Initialize WebSocket after server is created
            const wss = WebSocketService.initialize(server);
            app.locals.wss = wss;
            global.wss = wss;
            logger.info('WebSocket server initialized successfully');
        } catch (error) {
            logger.error('WebSocket initialization failed:', error);
            // Continue running the server even if WebSocket fails
        }

        // Handle server errors
        server.on('error', (error) => {
            logger.error('Server error:', error);
            process.exit(1);
        });

        // Handle process termination
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received. Closing server...');
            server.close(() => {
                logger.info('Server closed');
                process.exit(0);
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
    })
    .catch((error) => {
        logger.error('Server initialization failed:', error);
        process.exit(1);
    });