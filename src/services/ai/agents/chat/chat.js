// src/services/ai/agents/chat/chat.js
import { aiService } from '../../aiService.js';
import { WebSocketService } from '../../../webSocketService.js';
import { logger } from '../../../logger.js';
import { ChatDao } from '../../../dao/chatDao.js';
import { AiSettingsDao } from '../../../dao/aiSettingsDao.js';
import { TokenQuotaService } from '../../../tokenQuotaService.js';
import transactionAnalysisService from '../../../transactionAnalysisService.js';
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

// Load and combine instruction markdown files
const loadInstructions = async () => {
  try {
    const baseInstruction = await fs.readFile('./src/services/ai/agents/chat/instructions/base_instruction.md', 'utf-8');
    const knowledgeBase = await fs.readFile('./src/services/ai/agents/chat/instructions/knowledge_base.md', 'utf-8');
    const notebook = await fs.readFile('./src/services/ai/agents/chat/instructions/notebook.md', 'utf-8');

    // Combine according to specified format (plain text, no parsing)
    const combinedInstructions = `${baseInstruction}

This is your knowledge base:

${knowledgeBase}

These are some examples and extra information you should be aware of:

${notebook}
`;

    return combinedInstructions;
  } catch (err) {
    logger.error('Failed to load instruction files:', err);
    throw new Error(`Failed to load instruction files: ${err.message}`);
  }
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

// Extract all sections from transaction analysis except "SUGGESTED ANSWER TO THE MERCHANT'S DEVELOPERS"
const extractAnalysisForAI = (analysisResult) => {
  if (!analysisResult || typeof analysisResult !== 'string') {
    return '';
  }

  // Split into lines and extract everything except the suggested answer section
  const lines = analysisResult.split('\n');
  let content = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Stop at SUGGESTED ANSWER TO THE MERCHANT'S DEVELOPERS: section
    if (line.includes('SUGGESTED ANSWER TO THE MERCHANT\'S DEVELOPERS:')) {
      break;
    }
    
    content.push(line);
  }

  return content.join('\n').trim();
};

// Format transaction analysis data for AI context
const formatTransactionAnalysisData = (analyses) => {
  if (!analyses || !Array.isArray(analyses) || analyses.length === 0) {
    return '';
  }

  let formattedData = '\n\nTransaction Analysis Context:\n';
  formattedData += 'The following transaction analyses have been selected for AI context and may be relevant to the current conversation:\n\n';

  analyses.forEach((analysis, index) => {
    // Extract all sections except the suggested answer
    const analysisContent = extractAnalysisForAI(analysis.analysis_result);
    
    // Only include analyses that have content
    if (analysisContent) {
      formattedData += `--- Analysis ${index + 1}: ${analysis.analysis_name} ---\n`;
      formattedData += `Created: ${new Date(analysis.created_at).toLocaleString()}\n`;
      formattedData += `Token Count: ${analysis.token_count || 'N/A'}\n\n`;
      formattedData += `${analysisContent}\n\n`;
    }
  });

  formattedData += 'Note: These transaction analyses provide technical context about performance issues, bottlenecks, and optimization opportunities that may be relevant to current troubleshooting efforts.\n';

  return formattedData;
};

const chatAgent = {
  async createNewChatSession(userId) {
    const chatId = await ChatDao.createChatSession(userId);
    return chatId;
  },

  async handleUserMessage({ chatId, content, userId, tabId, abortSignal, dashboardData, projectId, environment, environmentContext, title }) {
    try {
      // Get user settings (this will create defaults if none exist)
      let userSettings, aiConfig;
      try {
        userSettings = await AiSettingsDao.getUserSettings(userId);
        aiConfig = AiSettingsDao.settingsToConfig(userSettings);
        logger.debug(`Retrieved AI settings for user ${userId}:`, { userSettings, aiConfig });

        // Optional verbose console output for debugging when enabled
        if (process.env.ENABLE_AI_OUTPUT === 'true') {
          console.log('\n=== AI CONFIGURATION ===');
          console.log('User:', userId);
          console.log('AI Model (user):', userSettings.aiModel);
          console.log('Response Style (user):', userSettings.responseStyle);
          console.log('Response Length (user):', userSettings.responseLength);
          console.log('Runtime Provider:', aiConfig.provider);
          console.log('Runtime Model:', aiConfig.model);
          console.log('Temperature:', aiConfig.temperature);
          console.log('MaxTokens:', aiConfig.maxTokens);
          console.log('Stream:', aiConfig.stream);
          console.log('==========================\n');
        }
      } catch (err) {
        logger.error(`Failed to get AI settings for user ${userId}, using defaults:`, { error: err.message });
        // Fallback to default config if settings retrieval fails
        aiConfig = {
          provider: 'google_vertex',
          model: 'gemini-2.5-flash', // Fast is the default
          temperature: 0.7,
          maxTokens: 16000,
          stream: true,
          topP: 0.95
        };
      }

      // Create chat session in DB if it doesn't exist (for new chats)
      const chatExists = await ChatDao.chatSessionExists(chatId);
      if (!chatExists) {
        await ChatDao.createChatSession(userId, chatId, projectId, environment, title || 'New Chat');
        logger.info(`Created new chat session in DB: ${chatId} for user: ${userId} with title: ${title || 'New Chat'}`);
      }

      // Performance optimization for large content
      const isLargeMessage = content && content.length > 1000000; // 1MB threshold
      
      if (isLargeMessage) {
        logger.info(`Processing large message: ${content.length} characters for chatId: ${chatId}`);
        
        // Send immediate progress update
        WebSocketService.broadcastToTab({
          type: 'thinking_chunk',
          chatId,
          content: 'Processing large message... This may take a moment.'
        }, tabId);
      }
      
      // 1) Save user message
      try {
        await ChatDao.saveMessage(chatId, 'user', content);
        logger.debug(`User message saved successfully for chatId: ${chatId}`);
      } catch (err) {
        logger.error(`Failed to save user message for chatId: ${chatId}`, {
          error: err.message,
          contentLength: content?.length || 0
        });
        throw new Error(`Database error while saving user message: ${err.message}`);
      }

      // 2) Get conversation history
      let conversation;
      try {
        conversation = await ChatDao.getMessagesByChatId(chatId);
        logger.debug(`Retrieved ${conversation.length} messages for chatId: ${chatId}`);
      } catch (err) {
        logger.error(`Failed to get conversation history for chatId: ${chatId}`, {
          error: err.message
        });
        throw new Error(`Database error while retrieving conversation history: ${err.message}`);
      }

      // 3) Create system message with server data
      const instructions = await loadInstructions();

      // Build base system message (without server data)
      const systemMessageFinal = defaultConfig.systemMessage + instructions;

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

      // 4) Get transaction analysis context if project and environment are available
      let transactionAnalysisText = '';
      logger.info(`[TRANSACTION ANALYSIS CONTEXT] Checking for transaction analysis context - projectId: "${projectId}", environment: "${environment}"`);
      
      if (projectId && environment) {
        try {
          logger.info(`[TRANSACTION ANALYSIS CONTEXT] Fetching analyses for project ${projectId}/${environment}`);
          const analysisResult = await transactionAnalysisService.getAnalysesForAiContext(projectId, environment, 3);
          logger.info(`[TRANSACTION ANALYSIS CONTEXT] Query result - success: ${analysisResult.success}, count: ${analysisResult.analyses?.length || 0}`);
          
          if (analysisResult.success && analysisResult.analyses.length > 0) {
            transactionAnalysisText = formatTransactionAnalysisData(analysisResult.analyses);
            logger.info(`[TRANSACTION ANALYSIS CONTEXT] Including ${analysisResult.analyses.length} transaction analyses in AI context for project ${projectId}/${environment}`);
          } else {
            logger.info(`[TRANSACTION ANALYSIS CONTEXT] No transaction analyses found for project ${projectId}/${environment}`);
          }
        } catch (err) {
          logger.error(`[TRANSACTION ANALYSIS CONTEXT] Failed to retrieve transaction analysis context for project ${projectId}/${environment}:`, err);
          // Continue without transaction analysis context - don't fail the entire request
        }
      } else {
        logger.info(`[TRANSACTION ANALYSIS CONTEXT] Skipping transaction analysis - missing projectId or environment`);
      }

      // 5) Format messages for the AI
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

      // Append server data and transaction analysis text to the last user message (i.e., the one just sent)
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          const contextData = serverDataText + transactionAnalysisText;
          messages[i].content = ' ===CONTEXT DATA START==='+ contextData + '===CONTEXT DATA END=== \n\n Now focus on the user message and only check the context data if the user requests or when doing some analysis or if it is relevant to answer the user: '+ messages[i].content;
          break;
        }
      }

      // 6) Get adapter with user config
      let adapter;
      try {
        adapter = aiService.getAdapter(aiConfig.provider, {
          ...aiConfig,
          systemMessage: systemMessageFinal // System message without server data
        });
        logger.debug(`AI adapter created successfully for provider: ${aiConfig.provider}, model: ${aiConfig.model}`);
      } catch (err) {
        logger.error(`Failed to create AI adapter for chatId: ${chatId}`, {
          error: err.message,
          provider: aiConfig.provider,
          model: aiConfig.model
        });
        throw new Error(`AI adapter initialization error: ${err.message}`);
      }

      // 6.5) Check token quota before generating
      let quotaCheckResult;
      try {
        // Combine system message and messages for token counting
        const inputForCounting = systemMessageFinal + '\n\n' + messages.map(m => `${m.role}: ${m.content}`).join('\n');
        
        quotaCheckResult = await TokenQuotaService.checkAndEnforceQuota(
          userId,
          inputForCounting,
          aiConfig.model
        );

        if (!quotaCheckResult.allowed) {
          logger.warn(`Token quota exceeded for user ${userId}`, {
            chatId,
            quotaInfo: quotaCheckResult.quotaInfo
          });

          // Send quota exceeded error via WebSocket
          const quotaError = TokenQuotaService.createQuotaExceededError(quotaCheckResult.quotaInfo);
          
          WebSocketService.broadcastToTab({
            type: 'quota_exceeded',
            chatId,
            ...quotaError
          }, tabId);

          // Don't throw error, just return gracefully
          return;
        }

        logger.info(`Token quota check passed for user ${userId}`, {
          chatId,
          estimatedInputTokens: quotaCheckResult.estimatedInputTokens,
          remaining: quotaCheckResult.quotaInfo.remaining,
          percentUsed: quotaCheckResult.quotaInfo.percentUsed
        });
      } catch (err) {
        logger.error(`Failed to check token quota for chatId: ${chatId}`, {
          error: err.message,
          userId
        });
        // Continue anyway - don't block on quota check errors
      }

      // 7) Generate stream  
      let stream;
      try {
        logger.debug(`Starting AI stream generation for chatId: ${chatId}`, {
          model: aiConfig.model,
          temperature: aiConfig.temperature,
          maxTokens: aiConfig.maxTokens,
          messageCount: messages.length,
          systemMessageLength: systemMessageFinal.length
        });
        
        const result = await adapter.generateStream({
          model: aiConfig.model,
          temperature: aiConfig.temperature,
          maxTokens: aiConfig.maxTokens,
          systemMessage: systemMessageFinal,
          messages: messages,
          signal: abortSignal
        });
        
        stream = result.stream;
        logger.debug(`AI stream generation started successfully for chatId: ${chatId}`);
      } catch (err) {
        logger.error(`Failed to generate AI stream for chatId: ${chatId}`, {
          error: err.message,
          stack: err.stack,
          provider: aiConfig.provider,
          model: aiConfig.model
        });
        throw new Error(`AI stream generation error: ${err.message}`);
      }

      // 8) Handle streaming response
      let fullAssistantReply = '';
      let fullThinkingContent = '';
      let hasStartedContent = false;
      let outputTextForTokenCounting = '';

      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          logger.info(`Streaming aborted for chatId=${chatId}`);
          break;
        }

        if (!chunk) continue;

        // Handle different content types
        if (typeof chunk === 'string') {
          // Legacy string response (from other adapters)
          fullAssistantReply += chunk;
          WebSocketService.broadcastToTab({
            type: 'chunk',
            chatId,
            content: chunk
          }, tabId);
        } else if (chunk.type === 'thinking') {
          // Thinking content
          fullThinkingContent += chunk.text;
          WebSocketService.broadcastToTab({
            type: 'thinking_chunk',
            chatId,
            content: chunk.text
          }, tabId);
        } else if (chunk.type === 'content') {
          // When we start getting content, finalize thinking if we have it
          if (!hasStartedContent && fullThinkingContent) {
            // Send thinking complete signal immediately without saving yet
            WebSocketService.broadcastToTab({
              type: 'thinking_complete',
              chatId,
              thinkingContent: fullThinkingContent
            }, tabId);
            
            hasStartedContent = true;
          }
          
          // Final answer content
          fullAssistantReply += chunk.text;
          WebSocketService.broadcastToTab({
            type: 'chunk',
            chatId,
            content: chunk.text
          }, tabId);
        } else if (chunk.type === 'token_usage') {
          // Token usage information from adapter
          outputTextForTokenCounting = chunk.outputText;
          logger.debug(`Received token usage info from adapter for chatId: ${chatId}`);
        }
      }

      // Track token usage after streaming completes
      if (quotaCheckResult && outputTextForTokenCounting) {
        try {
          await TokenQuotaService.trackAfterGeneration(
            userId,
            quotaCheckResult.estimatedInputTokens,
            outputTextForTokenCounting,
            aiConfig.model
          );
          logger.info(`Token usage tracked for user ${userId} in chat ${chatId}`);
        } catch (err) {
          logger.error(`Failed to track token usage for chatId: ${chatId}`, {
            error: err.message,
            userId
          });
          // Don't fail the request if tracking fails
        }
      }

      // 8) Handle completion
      if (!abortSignal?.aborted) {
        try {
          // Save thinking message first if we have thinking content
          if (fullThinkingContent) {
            try {
              await ChatDao.saveMessage(chatId, 'thinking', fullThinkingContent);
              logger.debug(`Thinking message saved for chatId: ${chatId}, length: ${fullThinkingContent.length}`);
            } catch (err) {
              logger.error(`Failed to save thinking message for chatId: ${chatId}`, {
                error: err.message,
                thinkingLength: fullThinkingContent.length
              });
              // Continue with assistant message even if thinking save fails
            }
            
            // If we haven't sent the thinking complete event yet, send it now
            if (!hasStartedContent) {
              WebSocketService.broadcastToTab({
                type: 'thinking_complete',
                chatId,
                thinkingContent: fullThinkingContent
              }, tabId);
            }
          }
          
          // Save assistant reply only if we have actual content
          if (fullAssistantReply && fullAssistantReply.trim().length > 0) {
            try {
              const assistantMessageId = await ChatDao.saveMessage(chatId, 'assistant', fullAssistantReply);
              logger.debug(`Assistant message saved for chatId: ${chatId}, length: ${fullAssistantReply.length}, messageId: ${assistantMessageId}`);
              
              WebSocketService.broadcastToTab({
                type: 'end',
                chatId,
                messageId: assistantMessageId
              }, tabId);
              
              // Send background update to ensure IndexedDB is updated regardless of current page
              try {
                const messages = await ChatDao.getMessagesByChatId(chatId);
                const chatSession = await ChatDao.getChatSession(chatId);
                
                if (chatSession) {
                  WebSocketService.broadcastToTab({
                    type: 'chat_message',
                    chatId,
                    messages: messages.map(msg => ({
                      id: msg.id,
                      role: msg.role,
                      content: msg.content,
                      timestamp: msg.created_at
                    })),
                    projectId: chatSession.projectId || '',
                    environment: chatSession.environment || ''
                  }, tabId);
                }
              } catch (err) {
                logger.warn(`Failed to send background chat update for chatId: ${chatId}`, {
                  error: err.message
                });
              }
            } catch (err) {
              logger.error(`Failed to save assistant message for chatId: ${chatId}`, {
                error: err.message,
                contentLength: fullAssistantReply.length
              });
              
              // Still notify frontend that streaming ended, even if save failed
              WebSocketService.broadcastToTab({
                type: 'end',
                chatId,
                error: 'Failed to save assistant response'
              }, tabId);
            }
          } else {
            logger.warn(`No assistant content to save for chatId: ${chatId}`, {
              thinkingLength: fullThinkingContent.length,
              hasStartedContent
            });
            
            // Still notify frontend that streaming ended
            WebSocketService.broadcastToTab({
              type: 'end',
              chatId
            }, tabId);
          }
        } catch (error) {
          logger.error('Error in completion handler for chatId:', chatId, {
            error: error.message,
            stack: error.stack,
            stage: 'completion'
          });
          
          // Send error to frontend for completion issues
          WebSocketService.broadcastToTab({
            type: 'error',
            message: 'Error completing message processing',
            stage: 'COMPLETION',
            chatId
          }, tabId);
        }
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
        // Enhanced error logging
        logger.error(`Error in handleUserMessage for chatId=${chatId}:`, {
          error: err.message,
          stack: err.stack,
          chatId,
          contentLength: content?.length || 0,
          errorType: err.constructor.name,
          stage: 'handleUserMessage'
        });
        
        // Determine error stage and provide specific messages
        let errorMessage = 'An error occurred while processing your request.';
        let errorStage = 'UNKNOWN';
        
        // Check for API quota/rate limit errors first (most specific)
        if (err.message.includes('quota') || err.message.includes('429')) {
          if (err.message.includes('250000') || err.message.includes('FreeTier')) {
            const estimatedTokens = Math.ceil((content?.length || 0) / 4);
            errorMessage = `API quota exceeded. Your message (~${estimatedTokens.toLocaleString()} tokens) exceeds the free tier limit of 250,000 tokens per minute. Please try a shorter message or upgrade your plan.`;
            errorStage = 'QUOTA_EXCEEDED';
          } else {
            errorMessage = 'API rate limit exceeded. Please wait a moment and try again, or consider using a shorter message.';
            errorStage = 'RATE_LIMIT';
          }
        } else if (err.message.includes('500') && err.message.includes('very large')) {
          const sizeMB = Math.round((content?.length || 0) / 1024 / 1024 * 100) / 100;
          errorMessage = `Message too large (${sizeMB}MB). The API has practical limits lower than advertised. Please break your content into smaller chunks.`;
          errorStage = 'SIZE_LIMIT';
        } else if (err.message.includes('413') || err.message.includes('payload too large')) {
          errorMessage = 'Message payload too large. Please reduce the message size and try again.';
          errorStage = 'PAYLOAD_SIZE';
        } else if (err.message.includes('generateStream') || err.message.includes('adapter')) {
          errorMessage = 'Error communicating with AI service.';
          errorStage = 'AI_SERVICE';
        } else if (err.message.includes('database') || err.message.includes('SQL')) {
          errorMessage = 'Database error while processing message.';
          errorStage = 'DATABASE';
        } else if (err.message.includes('saveMessage')) {
          errorMessage = 'Error saving message to database.';
          errorStage = 'MESSAGE_SAVE';
        } else if (err.message.includes('stream') || err.message.includes('iterator')) {
          errorMessage = 'Communication error with AI service. This may be due to network connectivity issues. Please try again.';
          errorStage = 'STREAMING';
        } else if (err.message.includes('timeout') || err.message.includes('Timeout')) {
          errorMessage = 'Request timed out. This may be due to network issues or the message being too large. Please try again.';
          errorStage = 'TIMEOUT';
        } else if (err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') || err.message.includes('network') || err.message.includes('connect')) {
          errorMessage = 'Network connection error. Please check your internet connection and try again.';
          errorStage = 'NETWORK';
        }
        
        WebSocketService.broadcastToTab({
          type: 'error',
          message: errorMessage,
          stage: errorStage,
          chatId,
          timestamp: new Date().toISOString()
        }, tabId);
      }
    }
  },
};

export default chatAgent;