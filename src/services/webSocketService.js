// src/services/webSocketService.js
import { WebSocketServer } from 'ws';
import { logger } from './logger.js';
import url from 'url';
import { v4 as uuidv4 } from 'uuid';
import chatAgent from './ai/agents/chat.js';

export class WebSocketService {
    static initialize(server) {
        const wss = new WebSocketServer({ noServer: true, path: '/ws' });

        // Store connections by tabId
        const connectionsByTabId = new Map();

        // Store controllers by chatId, so we can handle "stop_stream" repeatedly
        const abortControllers = new Map();

        wss.on('connection', (ws, req) => {
            const queryObject = url.parse(req.url, true).query;
            const clientId = queryObject.clientId || null;
            const tabId = queryObject.tabId || 'default-tab';

            ws.clientId = clientId;
            ws.tabId = tabId;

            // Keep track of the connection
            if (!connectionsByTabId.has(tabId)) {
                connectionsByTabId.set(tabId, []);
            }
            connectionsByTabId.get(tabId).push(ws);

            logger.info('WebSocket connection established', {
                userId: ws.userID,
                clientId: ws.clientId
            });

            ws.on('error', (error) => {
                logger.error('WebSocket error:', {
                    error: error.message,
                    userId: ws.userID
                });
            });

            ws.on('close', () => {
                logger.info('WebSocket connection closed', {
                    userId: ws.userID,
                    clientId: ws.clientId
                });

                // Remove ws from that tab
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

                // Optionally, abort all ongoing streams for this tab
                for (const [cid, entry] of abortControllers.entries()) {
                    if (entry.tabId === tabId) {
                        entry.controller.abort();
                        abortControllers.delete(cid);
                        logger.info(`Aborted stream for chatId=${cid} due to tab closure.`);
                    }
                }
            });

            // **** CORE WEBSOCKET MESSAGE HANDLER ****
            ws.on('message', async (message) => {
                try {
                    const parsedMessage = JSON.parse(message);

                    switch (parsedMessage.type) {
                        case 'new_chat': {
                            // Create a new session row in DB
                            const userId = ws.userID || null;
                            const chatId = await chatAgent.createNewChatSession(userId);

                            // Create an AbortController for this chat
                            const abortController = new AbortController();
                            abortControllers.set(chatId, {
                                controller: abortController,
                                tabId: parsedMessage.tabId
                            });

                            // Notify the client
                            ws.send(JSON.stringify({
                                type: 'new_chat',
                                chatId,
                                tabId: parsedMessage.tabId
                            }));
                            break;
                        }

                        case 'chat_message': {
                            // If we do not have a controller for that chat, create it
                            let entry = abortControllers.get(parsedMessage.chatId);
                            if (!entry) {
                                console.warn(`No AbortController found for chatId: ${parsedMessage.chatId}. Creating a new one so user can continue...`);
                                const newAbort = new AbortController();
                                abortControllers.set(parsedMessage.chatId, {
                                    controller: newAbort,
                                    tabId: parsedMessage.tabId
                                });
                                entry = abortControllers.get(parsedMessage.chatId);
                            }

                            // Now pass the entry's abortSignal to the chatAgent
                            chatAgent.handleUserMessage({
                                chatId: parsedMessage.chatId,
                                content: parsedMessage.content,
                                temperature: parsedMessage.temperature,
                                maxTokens: parsedMessage.maxTokens,
                                tabId: parsedMessage.tabId,
                                abortSignal: entry.controller.signal,
                                dashboardData: parsedMessage.dashboardData // Pass the dashboard data
                            }).catch(err => {
                                console.error('Error in handleUserMessage:', err);
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: 'An error occurred while processing your message.',
                                    chatId: parsedMessage.chatId
                                }));
                            });
                            break;
                        }

                        case 'stop_stream': {
                            const { chatId } = parsedMessage;
                            const entry = abortControllers.get(chatId);
                            if (entry) {
                                entry.controller.abort();
                                // Optionally remove it here if you prefer to disallow further messages:
                                // abortControllers.delete(chatId);

                                // Notify the client
                                ws.send(JSON.stringify({
                                    type: 'stream_stopped',
                                    chatId
                                }));
                            } else {
                                console.warn(`No AbortController found for chatId: ${chatId}`);
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: 'No active chat session found to stop.',
                                    chatId
                                }));
                            }
                            break;
                        }

                        default:
                            console.warn('Unknown message type:', parsedMessage.type);
                    }
                } catch (err) {
                    console.error('Failed to process WebSocket message:', err);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid message format.',
                        chatId: null
                    }));
                }
            });
        });

        // Attach references if needed
        wss.connectionsByTabId = connectionsByTabId;
        global.wss = wss;

        return wss;
    }

    static broadcastToTab(message, tabId) {
        if (!global.wss) {
            throw new Error('WebSocket server not initialized');
        }
        const connections = global.wss.connectionsByTabId.get(tabId);
        if (connections) {
            connections.forEach(client => {
                if (client.readyState === client.OPEN) {
                    client.send(JSON.stringify({
                        ...message,
                        tabId,
                        timestamp: new Date().toISOString()
                    }));
                }
            });
        }
    }
}
