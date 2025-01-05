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

const chatAgent = {
  async createNewChatSession(userId) {
    const chatId = await ChatDao.createChatSession(userId);
    return chatId;
  },

  async handleUserMessage({ chatId, content, temperature, maxTokens, tabId, abortSignal }) {
    try {
      // 1) Save the user message
      await ChatDao.saveMessage(chatId, 'user', content);

      // 2) Gather conversation
      const conversation = await ChatDao.getMessagesByChatId(chatId);
      const messagesForOpenAI = [
        { role: 'system', content: defaultConfig.systemMessage },
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
