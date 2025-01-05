// src/services/ai/agents/chat.js
import { aiService } from '../aiService.js';
import { WebSocketService } from '../../webSocketService.js';
import { logger } from '../../logger.js';

// We maintain a simple in-memory conversation store.
// In production, you might use Redis or a database.
const conversationHistoryMap = new Map();

/**
 * Example config for your chat agent (using "openai" with streaming).
 * Modify model, temperature, or maxTokens as needed.
 */
const defaultConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.1,
  maxTokens: 3000,
  stream: true,
  systemMessage: 'You are a helpful assistant.',
};

const chatAgent = {
  /**
   * Handle incoming user messages and stream AI responses via WebSocket.
   *
   * @param {Object} params
   * @param {string} params.chatId - Unique ID for this chat session
   * @param {string} params.content - User's message content
   * @param {number} params.temperature - Override temperature
   * @param {number} params.maxTokens - Override max tokens
   * @param {string} params.tabId - The tab ID to broadcast chunks to
   */
  async handleUserMessage({ chatId, content, temperature, maxTokens, tabId }) {
    try {
      // 1) Retrieve or create conversation
      let conversation = conversationHistoryMap.get(chatId);
      if (!conversation) {
        conversation = [];
        conversationHistoryMap.set(chatId, conversation);
      }

      // 2) Push user message into conversation memory
      conversation.push({
        role: 'user',
        content,
      });

      logger.info(`Received user message in chat ${chatId}: ${content}`);

      // 3) Prepare messages array for OpenAI (system + full conversation)
      //    The system prompt can be prepended, plus each user/assistant turn.
      const messagesForOpenAI = [
        {
          role: 'system',
          content: defaultConfig.systemMessage,
        },
        ...conversation.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      ];

      // 4) Get the correct adapter with updated config
      const adapter = aiService.getAdapter(defaultConfig.provider, {
        ...defaultConfig,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        stream: true, // We want streaming
      });

      // 5) Stream from OpenAI
      //    We'll do chunk-based broadcasting for partial tokens
      const { stream } = await adapter.generateStream({
        model: defaultConfig.model,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        systemMessage: defaultConfig.systemMessage,
        messages: messagesForOpenAI,
      });

      let fullAssistantReply = '';

      // Loop over the async iterator
      for await (const token of stream) {
        if (!token) continue;
        // Append partial token to our growing text
        fullAssistantReply += token;

        // Broadcast partial chunk to the frontend
        WebSocketService.broadcastToTab(
          {
            type: 'chunk',
            chatId,
            content: token,
          },
          tabId
        );
      }

      // 6) When done, store the full assistant reply in conversation
      conversation.push({
        role: 'assistant',
        content: fullAssistantReply,
      });

      // 7) Signal end of streaming to the frontend
      WebSocketService.broadcastToTab(
        {
          type: 'end',
          chatId,
        },
        tabId
      );

      logger.info(`Chat ${chatId} - finished streaming assistant reply.`);
    } catch (err) {
      logger.error(`Chat ${chatId} - Error in handleUserMessage: ${err.message}`);
      WebSocketService.broadcastToTab(
        {
          type: 'error',
          message: 'An error occurred while processing your request. Please try again later.',
        },
        tabId
      );
    }
  },
};

export default chatAgent;
