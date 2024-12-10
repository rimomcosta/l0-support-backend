// src/services/webSocketService.js
import { WebSocketServer } from 'ws';  // Change this line
import { logger } from './logger.js';

export class WebSocketService {
    static initialize(server) {
        try {
            const wss = new WebSocketServer({ 
                server,
                path: '/ws'
            });
            
            wss.on('connection', (ws, req) => {
                logger.info('New WebSocket connection established', {
                    ip: req.socket.remoteAddress,
                    timestamp: new Date().toISOString()
                });
                
                // Handle incoming messages
                ws.on('message', (message) => {
                    try {
                        const data = JSON.parse(message);
                        logger.debug('WebSocket message received:', data);
                    } catch (error) {
                        logger.error('Failed to parse WebSocket message:', error);
                    }
                });

                // Handle connection errors
                ws.on('error', (error) => {
                    logger.error('WebSocket error:', error);
                });

                // Handle connection close
                ws.on('close', () => {
                    logger.info('WebSocket connection closed');
                });

                // Send initial connection confirmation
                ws.send(JSON.stringify({
                    type: 'connection',
                    status: 'connected',
                    timestamp: new Date().toISOString()
                }));
            });

            // Handle server-level errors
            wss.on('error', (error) => {
                logger.error('WebSocket server error:', error);
            });

            return wss;
        } catch (error) {
            logger.error('Failed to initialize WebSocket server:', error);
            throw error;
        }
    }

    static getClientConnection(req) {
        if (!req.app.locals.wss) {
            throw new Error('WebSocket server not initialized');
        }

        const clients = Array.from(req.app.locals.wss.clients)
            .filter(client => client.readyState === WebSocket.OPEN);

        if (clients.length === 0) {
            throw new Error('No active WebSocket connections');
        }

        return clients[0];
    }

    static broadcast(message) {
        if (!global.wss) {
            throw new Error('WebSocket server not initialized');
        }

        global.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}