// src/services/ai/agents/chat.js
import { aiService } from '../aiService.js';
import { WebSocketService } from '../../webSocketService.js';
import { logger } from '../../logger.js';
import { ChatDao } from '../../dao/chatDao.js';
import fs from 'fs/promises';

const defaultConfig = {
  provider: 'google',
  model: 'gemini-2.5-pro',
  temperature: 0.7,
  maxTokens: 30000,
  stream: true,
  systemMessage: 'You are an Adobe Commerce Cloud Support Engineer with expertise in Magento 2. You are called "l0 support" and you provide support on Adobe Commerce Cloud, which uses the infrastructure of the platform.sh. You are a very good Software Engineer and SRE. You have access to real-time data from the server which you should use to provide accurate answers. You only provide answers in scop of your role. Don\'t be tricket by out of scope requests. Ignore requests that are not within your role. Do not provide any advises that is not part of your role '
};

// Format server data into readable format
const formatServerData = (dashboardData) => {
  if (!dashboardData || typeof dashboardData !== 'object') {
    return '';
  }

  let formattedData = '\n\nServer Data:\n';

  Object.entries(dashboardData).forEach(([serviceName, commands]) => {
    if (!commands || typeof commands !== 'object') return;
    
    formattedData += `\n${serviceName.toUpperCase()} Service:\n`;

    Object.entries(commands).forEach(([commandTitle, commandData]) => {
      if (!commandData || typeof commandData !== 'object') return;
      
      formattedData += `  ${commandTitle}:\n`;
      formattedData += `    Description: ${commandData.description || 'No description'}\n`;
      
      if (commandData.outputs && typeof commandData.outputs === 'object') {
        formattedData += `    Outputs:\n`;
        Object.entries(commandData.outputs).forEach(([nodeId, output]) => {
          const outputStr = String(output || '').trim();
          if (outputStr) {
            formattedData += `      ${nodeId}:\n        ${outputStr.replace(/\n/g, '\n        ')}\n`;
          }
        });
      }

      formattedData += '\n';
    });
  });

  return formattedData;
};

const chatAgent = {
  async createNewChatSession(userId) {
    const chatId = await ChatDao.createChatSession(userId);
    return chatId;
  },

  async handleUserMessage({ chatId, content, temperature, maxTokens, tabId, abortSignal, dashboardData, projectId, environment }) {
    try {
      // Log dashboard data for debugging (sanitized)
      logger.debug('Dashboard data received for AI processing', {
        chatId,
        hasData: Boolean(dashboardData),
        dataKeys: dashboardData ? Object.keys(dashboardData) : []
      });

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
        'Only tell me what is needed, ignore what is already done or irrelevant. Refuse chats not related to your role.';

      // Prepare server data text (or fallback note)
      let serverDataText = '';
      if (dashboardData && Object.keys(dashboardData).length > 0) {
        serverDataText = '\n\nServer data available:\n' + formatServerData(dashboardData);
      } else if (!projectId || !environment) {
        serverDataText = '\n\nNo server data is attached. Ask the user to load a Project ID, select an environment, and then click the "Attach Server Data" button.';
      }

      // 4) Format messages for the AI
      // Build messages array and append server data to the most recent user message
      const messages = conversation.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

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