// src/services/webSocketService.js
import { WebSocketServer } from 'ws';
import { logger } from './logger.js';
import url from 'url';

export class WebSocketService {
    static initialize(server) {
        const wss = new WebSocketServer({ noServer: true, path: '/ws' });

        // Store connections by tabId
        const connectionsByTabId = new Map();

        wss.on('connection', (ws, req) => {
            const queryObject = url.parse(req.url, true).query;
            const clientId = queryObject.clientId || null;
            const tabId = queryObject.tabId; // Get tabId from query parameters

            ws.clientId = clientId;
            ws.tabId = tabId;

            // Store the connection
            if (!connectionsByTabId.has(tabId)) {
                connectionsByTabId.set(tabId, []);
            }
            connectionsByTabId.get(tabId).push(ws);

            logger.info('WebSocket connection established', {
                sessionId: ws.sessionID,
                userId: ws.userID,
                clientId: ws.clientId,
                tabId: ws.tabId
            });

            ws.on('error', (error) => {
                logger.error('WebSocket error:', {
                    error: error.message,
                    sessionId: ws.sessionID,
                    userId: ws.userID,
                    clientId: ws.clientId,
                    tabId: ws.tabId
                });
            });

            ws.on('close', () => {
                logger.info('WebSocket connection closed', {
                    sessionId: ws.sessionID,
                    userId: ws.userID,
                    clientId: ws.clientId,
                    tabId: ws.tabId
                });

                // Remove the connection
                const connections = connectionsByTabId.get(tabId);
                if (connections) {
                    const index = connections.indexOf(ws);
                    if (index > -1) {
                        connections.splice(index, 1);
                    }
                    if (connections.length === 0) {
                        connectionsByTabId.delete(tabId);
                    }
                }
            });
        });

        // Add the connections map to the WebSocket server instance
        wss.connectionsByTabId = connectionsByTabId;

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

    static broadcastToTab(message, tabId) {
        if (!global.wss) {
            throw new Error('WebSocket server not initialized');
        }

        const connections = global.wss.connectionsByTabId.get(tabId);
        if (connections) {
            connections.forEach(client => {
                if (client.readyState === client.OPEN) {
                    // Add tabId to the message
                    client.send(JSON.stringify({
                        ...message,
                        tabId: tabId, // Include tabId in the message
                        timestamp: new Date().toISOString()
                    }));
                }
            });
        }
    }
}