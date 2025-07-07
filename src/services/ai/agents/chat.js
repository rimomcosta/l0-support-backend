// src/services/ai/agents/chat.js
import { aiService } from '../aiService.js';
import { WebSocketService } from '../../webSocketService.js';
import { logger } from '../../logger.js';
import { ChatDao } from '../../dao/chatDao.js';
import fs from 'fs/promises';

const defaultConfig = {
  provider: 'google_vertex',
  model: 'gemini-2.5-pro',
  temperature: 0.7,
  maxTokens: 65536,
  topP: 0.95,
  stream: true,
  systemMessage: ' '
};

// Format server data into readable format - optimized for simplified structure
const formatServerData = (dashboardData) => {
  if (!dashboardData || !Array.isArray(dashboardData)) {
    return '';
  }

  let formattedData = '\n\nServer Data:\n';

  dashboardData.forEach((item, index) => {
    if (item && item.title && item.output) {
      formattedData += `\n${item.title}:\n`;
      const outputStr = String(item.output || '').trim();
      if (outputStr) {
        formattedData += `${outputStr.replace(/\n/g, '\n  ')}\n\n`;
      }
    }
  });

  return formattedData;
};

const chatAgent = {
  async createNewChatSession(userId) {
    const chatId = await ChatDao.createChatSession(userId);
    return chatId;
  },

  async handleUserMessage({ chatId, content, temperature, maxTokens, tabId, abortSignal, dashboardData, projectId, environment, environmentContext }) {
    try {
      // 1) Save user message
      await ChatDao.saveMessage(chatId, 'user', content);

      // 2) Get conversation history
      const conversation = await ChatDao.getMessagesByChatId(chatId);

      // 3) Create system message with server data
      const instructions = await fs.readFile('./src/services/ai/agents/chatInstructions.js', 'utf-8');

      // Build base system message (without server data)
      const systemMessageFinal =
        defaultConfig.systemMessage +
        instructions +
        'Refuse chats not related to your role.';

      // Prepare server data text (or fallback note)
      let serverDataText = '';
      const hasServerData = dashboardData && Array.isArray(dashboardData) && dashboardData.length > 0;
      

      
      if (hasServerData) {
        const formattedData = formatServerData(dashboardData);
        serverDataText = `\n\nCurrent Environment: You are now working with the \"${environment}\" environment${projectId ? ` for project \"${projectId}\"` : ''}.\n\nServer data available:\n` + formattedData;
      } else if (!projectId || !environment) {
        serverDataText = '\n\nNo server data is attached. Ask the user to load a Project ID, select an environment, and then click the "Attach Server Data" button.';
      } else {
        // Project and environment loaded but attach server data not selected
        serverDataText = `\n\nCurrent Environment: You are now working with the \"${environment}\" environment${projectId ? ` for project \"${projectId}\"` : ''}.\n\nNo server data is attached. Click the \"Attach Server Data\" button to include real-time server information in this conversation.`;
      }

      // 4) Format messages for the AI
      // Build messages array and append server data to the most recent user message
      const messages = conversation.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // If we received hidden environment context, prepend it to last user message
      if (environmentContext) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            messages[i].content = `${environmentContext}\n\n${messages[i].content}`;
            break;
          }
        }
      }

      // Append server data text to the last user message (i.e., the one just sent)
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          messages[i].content = messages[i].content + serverDataText;
          break;
        }
      }

      // 5) Get adapter with config
      const adapter = aiService.getAdapter(defaultConfig.provider, {
        ...defaultConfig,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        topP: defaultConfig.topP,
        stream: true,
        systemMessage: systemMessageFinal // System message without server data
      });

      // 6) Generate stream
      const { stream } = await adapter.generateStream({
        model: defaultConfig.model,
        temperature: temperature ?? defaultConfig.temperature,
        maxTokens: maxTokens ?? defaultConfig.maxTokens,
        systemMessage: systemMessageFinal,
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