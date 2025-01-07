// src/services/ai/agents/chat.js
import { aiService } from '../aiService.js';
import { WebSocketService } from '../../webSocketService.js';
import { logger } from '../../logger.js';
import { ChatDao } from '../../dao/chatDao.js';

const defaultConfig = {
  provider: 'firefall',
//   model: 'claude-3-5-sonnet-20241022',
  temperature: 0.1,
  maxTokens: 3000,
  stream: true,
  systemMessage: 'You are a helpful assistant specialized in Adobe Commerce Cloud infrastructure. You have access to real-time data from the server which you should use to provide accurate answers.'
};

// Format server data into readable format
const formatServerData = (dashboardData) => {
    if (!dashboardData || typeof dashboardData !== 'object') {
      return '';
    }
    
    let formattedData = '\n\nServer Data:\n';
    
    Object.entries(dashboardData).forEach(([serviceName, commands]) => {
      formattedData += `\n${serviceName.toUpperCase()} Service:\n`;
      
      Object.entries(commands).forEach(([commandTitle, nodeOutputs]) => {
        formattedData += `  ${commandTitle}:\n`;
        
        Object.entries(nodeOutputs).forEach(([nodeId, output]) => {
          formattedData += `    ${nodeId}:\n      ${output.replace(/\n/g, '\n      ')}\n`;
        });
      });
    });
    
    return formattedData;
  };

const chatAgent = {
  async createNewChatSession(userId) {
    const chatId = await ChatDao.createChatSession(userId);
    return chatId;
  },

  async handleUserMessage({ chatId, content, temperature, maxTokens, tabId, abortSignal, dashboardData }) {
    try {
      // 1) Save user message
      await ChatDao.saveMessage(chatId, 'user', content);

      // 2) Get conversation history
      const conversation = await ChatDao.getMessagesByChatId(chatId);

      // 3) Create system message with server data
      const systemMessageWithData = defaultConfig.systemMessage + formatServerData(dashboardData);

      // 4) Format messages for the AI
      const messages = [
        ...conversation.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      // 5) Get adapter with config
      const adapter = aiService.getAdapter(defaultConfig.provider, {
        ...defaultConfig,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        stream: true,
        systemMessage: systemMessageWithData // Pass complete system message with data
      });

      // 6) Generate stream
      const { stream } = await adapter.generateStream({
        model: defaultConfig.model,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        systemMessage: systemMessageWithData,
        messages: messages,
        signal: abortSignal
      });

      // 7) Handle streaming response
      let fullAssistantReply = '';
      
      for await (const token of stream) {
        if (abortSignal?.aborted) {
          logger.info(`Streaming aborted for chatId=${chatId}`);
          break;
        }
        
        if (!token) continue;
        
        fullAssistantReply += token;
        
        // Send chunk to frontend
        WebSocketService.broadcastToTab({
          type: 'chunk',
          chatId,
          content: token
        }, tabId);
      }

      // 8) Handle completion
      if (!abortSignal?.aborted) {
        await ChatDao.saveMessage(chatId, 'assistant', fullAssistantReply);
        WebSocketService.broadcastToTab({
          type: 'end',
          chatId
        }, tabId);
      } else {
        WebSocketService.broadcastToTab({
          type: 'stream_stopped',
          chatId
        }, tabId);
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        logger.info(`Streaming aborted by user for chatId=${chatId}`);
        WebSocketService.broadcastToTab({
          type: 'stream_stopped',
          chatId
        }, tabId);
      } else {
        logger.error(`Error in handleUserMessage for chatId=${chatId}: ${err}`);
        WebSocketService.broadcastToTab({
          type: 'error',
          message: 'An error occurred while processing your request.',
          chatId
        }, tabId);
      }
    }
  },
};

export default chatAgent;