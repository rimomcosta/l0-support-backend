// src/services/ai/agents/chat.js
import { aiService } from '../aiService.js';
import { WebSocketService } from '../../webSocketService.js';
import { logger } from '../../logger.js';
import { ChatDao } from '../../dao/chatDao.js';

const defaultConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.1,
  maxTokens: 3000,
  stream: true,
  systemMessage: 'You are a helpful assistant.',
};

const formatDashboardData = (serviceResults) => {
    let contextData = 'Current System Status:\n\n';
    
    for (const [service, data] of Object.entries(serviceResults)) {
      if (data?.results) {
        contextData += `${service.toUpperCase()} Service:\n`;
        data.results.forEach(result => {
          contextData += `- Command: ${result.command}\n`;
          if (Array.isArray(result.results)) {
            result.results.forEach(r => {
              contextData += `  Output: ${JSON.stringify(r)}\n`;
            });
          } else {
            contextData += `  Output: ${JSON.stringify(result.results)}\n`;
          }
        });
        contextData += '\n';
      }
    }
    
    return contextData;
  };

const chatAgent = {
  async createNewChatSession(userId) {
    const chatId = await ChatDao.createChatSession(userId);
    return chatId;
  },

  async handleUserMessage({ chatId, content, temperature, maxTokens, tabId, abortSignal, dashboardData }) {
    try {
      // 1) Save the user message
      await ChatDao.saveMessage(chatId, 'user', content);

      // 2) Gather conversation
      const conversation = await ChatDao.getMessagesByChatId(chatId);

      const systemMessage = `You are a helpful assistant specialized in Adobe Commerce Cloud infrastructure.
        You have access to real-time data from the server which you should use to provide accurate answers.
        
        ${formatDashboardData(dashboardData)}`;

      const messagesForOpenAI = [
        { role: 'system', content: systemMessage },
        ...conversation.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
      ];

      // 3) Get adapter
      const adapter = aiService.getAdapter(defaultConfig.provider, {
        ...defaultConfig,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        stream: true,
      });

      // 4) Stream
      const { stream } = await adapter.generateStream({
        model: defaultConfig.model,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        systemMessage: defaultConfig.systemMessage,
        messages: messagesForOpenAI,
        signal: abortSignal,
      });

      let fullAssistantReply = '';

      for await (const token of stream) {
        if (abortSignal && abortSignal.aborted) {
          logger.info(`Streaming aborted for chatId=${chatId}`);
          break;
        }
        if (!token) continue;
        fullAssistantReply += token;

        WebSocketService.broadcastToTab({
          type: 'chunk',
          chatId,
          content: token
        }, tabId);
      }

      if (!abortSignal || !abortSignal.aborted) {
        // Save the entire assistant reply
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
