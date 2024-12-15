// src/services/webSocketService.js
import { WebSocketServer } from 'ws';
import { logger } from './logger.js';
import url from 'url';

export class WebSocketService {
    static initialize(server) {
        const wss = new WebSocketServer({ noServer: true, path: '/ws' });

        wss.on('connection', (ws, req) => {
            // Parse the clientId from query params
            const queryObject = url.parse(req.url, true).query;
            const clientId = queryObject.clientId || null;
            ws.clientId = clientId;

            logger.info('WebSocket connection established', {
                sessionId: ws.sessionID,
                userId: ws.userID,
                clientId: ws.clientId
            });

            ws.on('error', (error) => {
                logger.error('WebSocket error:', {
                    error: error.message,
                    sessionId: ws.sessionID,
                    userId: ws.userID,
                    clientId: ws.clientId
                });
            });

            ws.on('close', () => {
                logger.info('WebSocket connection closed', {
                    sessionId: ws.sessionID,
                    userId: ws.userID,
                    clientId: ws.clientId
                });
            });
        });

        return wss;
    }

    static broadcastToUser(message, userId) {
        if (!global.wss) {
            throw new Error('WebSocket server not initialized');
        }

        global.wss.clients.forEach(client => {
            if (client.readyState === client.OPEN && client.userID === userId) {
                client.send(JSON.stringify({
                    ...message,
                    timestamp: new Date().toISOString(),
                    userId: userId
                }));
            }
        });
    }

    static broadcastToSession(message, sessionId) {
        if (!global.wss) {
            throw new Error('WebSocket server not initialized');
        }

        global.wss.clients.forEach(client => {
            if (client.readyState === client.OPEN && client.sessionID === sessionId) {
                client.send(JSON.stringify({
                    ...message,
                    timestamp: new Date().toISOString(),
                    sessionId: sessionId
                }));
            }
        });
    }
}
