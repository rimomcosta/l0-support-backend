// src/services/server.js
import dotenv from 'dotenv';
import { logger } from './logger.js';
import { initializeApp } from '../app.js';
import { WebSocketService } from './webSocketService.js';
import url from 'url';

dotenv.config();

const port = process.env.PORT || 4000;

initializeApp()
    .then(({ app, sessionParser }) => {
        const server = app.listen(port, () => {
            logger.info(`Server running on port ${port}`);
            logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger.debug('Server configuration:', {
                clientOrigin: process.env.CLIENT_ORIGIN,
                apiUrl: process.env.REACT_APP_API_URL,
                oktaRedirectUri: process.env.OKTA_REDIRECT_URI
            });
        });

        const wss = WebSocketService.initialize(server);

        // Handle the upgrade event for WebSocket to run sessionParser
        server.on('upgrade', (request, socket, head) => {
            sessionParser(request, {}, async () => {
                if (!request.session || !request.session.user) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                // Parse the URL and query parameters
                const queryObject = url.parse(request.url, true).query;
                const tabId = queryObject.tabId;

                // Store tabId in the session
                request.session.user.tabId = tabId;
                await new Promise((resolve, reject) => {
                    request.session.save((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                // If session is valid, complete upgrade
                wss.handleUpgrade(request, socket, head, (ws) => {
                    ws.sessionID = request.sessionID;
                    ws.userID = request.session.user.id;
                    ws.tabId = tabId; // Add tabId to the ws object
                    wss.emit('connection', ws, request);
                });
            });
        });

        app.locals.wss = wss;
        global.wss = wss;
        logger.info('WebSocket server initialized successfully');

        server.on('error', (error) => {
            logger.error('Server error:', error);
            process.exit(1);
        });

        process.on('SIGTERM', async () => {
            logger.info('SIGTERM received. Closing server...');
            try {
                // Cleanup all Redis sessions
                await cleanupAllSessions();
                
                // Close WebSocket connections
                wss.clients.forEach(client => {
                    client.terminate();
                });
        
                // Close the server
                server.close(() => {
                    logger.info('Server closed');
                    process.exit(0);
                });
            } catch (error) {
                logger.error('Error during server shutdown:', error);
                process.exit(1);
            }
        });

        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
    })
    .catch((error) => {
        logger.error('Server initialization failed:', error);
        process.exit(1);
    });