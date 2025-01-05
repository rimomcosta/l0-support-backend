// src/services/webSocketService.js
import { WebSocketServer } from 'ws';
import { logger } from './logger.js';
import url from 'url';
import { v4 as uuidv4 } from 'uuid';
import chatAgent from './ai/agents/chat.js'; // We'll import our chat agent

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

      // **** CORE WEBSOCKET MESSAGE HANDLER ****
      ws.on('message', async (message) => {
        console.log('Message received from frontend:', message);

        try {
          const parsedMessage = JSON.parse(message);
          console.log('Parsed message:', parsedMessage);
          switch (parsedMessage.type) {
            case 'new_chat': {
              // Generate or retrieve a new chatId
              const chatId = uuidv4();

              console.log('Created new chatId:', chatId, 'for tab:', parsedMessage.tabId);

              // Send it back to the client
              ws.send(JSON.stringify({
                type: 'new_chat',
                chatId,
                tabId: parsedMessage.tabId
              }));
              break;
            }

            case 'chat_message': {
              // The user has typed a message. We have tabId, chatId, content, etc.
              console.log('Received chat_message for chatId:', parsedMessage.chatId);
              console.log('User content:', parsedMessage.content);

              // Example:
              // Use your chat agent to process or stream AI content
              const response = await chatAgent.handleUserMessage({
                chatId: parsedMessage.chatId,
                content: parsedMessage.content,
                temperature: parsedMessage.temperature,
                maxTokens: parsedMessage.maxTokens,
                tabId: parsedMessage.tabId
              });

              // For a simple "instant" response (non-streaming):
              // broadcast the final result
              WebSocketService.broadcastToTab({
                type: 'chunk',
                chatId: parsedMessage.chatId,
                content: response
              }, parsedMessage.tabId);

              // Then broadcast "end"
              WebSocketService.broadcastToTab({
                type: 'end',
                chatId: parsedMessage.chatId
              }, parsedMessage.tabId);

              break;
            }

            default:
              console.warn('Unknown message type:', parsedMessage.type);
          }
        } catch (err) {
          console.error('Failed to process WebSocket message:', err);
        }
      });
    });

    // Attach the connections map to our WebSocket server instance
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
            tabId: tabId,
            timestamp: new Date().toISOString()
          }));
        }
      });
    }
  }
}
