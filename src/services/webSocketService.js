// src/services/webSocketService.js
import { WebSocketServer } from 'ws';
import { logger } from './logger.js';
import { logActivity } from './activityLogger.js';
import url from 'url';
import { v4 as uuidv4 } from 'uuid';
import chatAgent from './ai/agents/chat.js';

// Sanitize user input for safe processing while preserving original content
const sanitizeUserInput = (content) => {
    if (!content || typeof content !== 'string') {
        return content;
    }
    
    // Basic protection against control characters that could break JSON/logging
    // but preserve the actual content for the LLM
    // Remove null bytes and other control characters that could cause issues
    return content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

// Optimize WebSocket message handler for large payloads
const handleLargeMessage = async (ws, parsedMessage, abortControllers, logActivity, logger, chatAgent) => {
    const { chatId, content, temperature, maxTokens, tabId, dashboardData, projectId, environment, environmentContext } = parsedMessage;
    
    // If we do not have a controller for that chat, create it
    let entry = abortControllers.get(chatId);
    if (!entry) {
        logger.warn(`No AbortController found for chatId: ${chatId}. Creating a new one.`);
        const newAbort = new AbortController();
        abortControllers.set(chatId, {
            controller: newAbort,
            tabId: tabId
        });
        entry = abortControllers.get(chatId);
    }

    // Sanitize user content while preserving original for LLM
    const sanitizedContent = sanitizeUserInput(content);
    const isLargeMessage = sanitizedContent && sanitizedContent.length > 1000000; // 1MB threshold

    // Log chat message activity with size info
    if (ws.userID) {
        const messageLength = sanitizedContent?.length || 0;
        logActivity.chat.message(ws.userID, 'unknown', chatId, messageLength);
        
        if (isLargeMessage) {
            logger.info(`Processing large message: ${messageLength} characters for chatId: ${chatId}`);
        }
    }

    // Send immediate acknowledgment for large messages
    if (isLargeMessage) {
        ws.send(JSON.stringify({
            type: 'large_message_received',
            chatId,
            messageSize: sanitizedContent.length,
            tabId
        }));
    }

    // Process the message normally (timeout protection removed to fix issues)
    await chatAgent.handleUserMessage({
        chatId,
        content: sanitizedContent,
        temperature,
        maxTokens,
        tabId,
        abortSignal: entry.controller.signal,
        dashboardData,
        projectId,
        environment,
        environmentContext
    });
};

export class WebSocketService {
    static initialize(server) {
        const wss = new WebSocketServer({ 
            noServer: true, 
            path: '/ws',
            maxPayload: 100 * 1024 * 1024 // 100MB limit for large message inputs
        });

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

            // Log activity for WebSocket connection
            if (ws.userID && ws.sessionID) {
                // Get user email from session if available
                const userEmail = req.session?.user?.email || 'unknown';
                logActivity.websocket.connected(ws.userID, userEmail, ws.clientId);
            }

            const userTabKey = `${ws.userID || 'unknown'}::${ws.tabId}`;
            if (!global.activeUserTabs) global.activeUserTabs = new Map();
            const oldWs = global.activeUserTabs.get(userTabKey);
            if (oldWs && oldWs !== ws && oldWs.readyState === ws.OPEN) {
                oldWs.close(4000, 'Duplicate tab detected, closing old connection.');
            }
            global.activeUserTabs.set(userTabKey, ws);

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

                // Log activity for WebSocket disconnection
                if (ws.userID) {
                    const userEmail = 'unknown'; // We don't have session here
                    logActivity.websocket.disconnected(ws.userID, userEmail, ws.clientId);
                }

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

                global.activeUserTabs.delete(userTabKey);
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

                            // Log chat creation activity
                            if (userId) {
                                logActivity.chat.created(userId, 'unknown', chatId);
                            }
                            break;
                        }

                        case 'chat_message': {
                            try {
                                await handleLargeMessage(ws, parsedMessage, abortControllers, logActivity, logger, chatAgent);
                            } catch (err) {
                                logger.error('Error in handleLargeMessage:', {
                                    error: err.message,
                                    stack: err.stack,
                                    chatId: parsedMessage.chatId,
                                    messageSize: parsedMessage.content?.length || 0,
                                    errorType: err.constructor.name
                                });
                                
                                // Provide more specific error messages
                                let errorMessage = 'An error occurred while processing your message.';
                                let errorDetails = '';
                                
                                if (err.message.includes('timeout') || err.message.includes('Timeout')) {
                                    errorMessage = 'Request timed out. Large messages may take longer to process.';
                                    errorDetails = 'TIMEOUT_ERROR';
                                } else if (err.message.includes('fetch') || err.message.includes('network')) {
                                    errorMessage = 'Network error while communicating with AI service.';
                                    errorDetails = 'NETWORK_ERROR';
                                } else if (err.message.includes('JSON') || err.message.includes('parse')) {
                                    errorMessage = 'Error parsing AI service response.';
                                    errorDetails = 'PARSE_ERROR';
                                } else if (err.message.includes('API') || err.message.includes('auth')) {
                                    errorMessage = 'AI service authentication or API error.';
                                    errorDetails = 'API_ERROR';
                                } else if (err.message.includes('database') || err.message.includes('SQL')) {
                                    errorMessage = 'Database error while saving message.';
                                    errorDetails = 'DATABASE_ERROR';
                                } else if (err.message.includes('stream') || err.message.includes('iterator')) {
                                    errorMessage = 'Error in AI response streaming.';
                                    errorDetails = 'STREAM_ERROR';
                                }
                                
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: errorMessage,
                                    details: errorDetails,
                                    chatId: parsedMessage.chatId,
                                    timestamp: new Date().toISOString()
                                }));
                            }
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
                                logger.warn(`No AbortController found for chatId: ${chatId}`);
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: 'No active chat session found to stop.',
                                    chatId
                                }));
                            }
                            break;
                        }

                        default:
                            logger.warn('Unknown message type:', { type: parsedMessage.type });
                    }
                } catch (err) {
                    logger.error('Failed to process WebSocket message:', {
                        error: err.message
                    });
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


