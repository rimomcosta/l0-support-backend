// src/services/contextWindowService.js
// Service for managing conversation context window limits
// Implements intelligent truncation to keep conversations within model limits

import { tokenCountingService } from './tokenCountingService.js';
import { getSafeLimit, getMaxLimit, exceedsSafeLimit, getModelLimits } from '../config/modelLimits.js';
import { logger } from './logger.js';

/**
 * Context Window Management Service
 * 
 * Handles automatic truncation of conversation history to fit within
 * model context limits. Uses token counting to ensure conversations
 * never exceed safe limits.
 * 
 * Strategy: Remove oldest message pairs (user + assistant) to preserve
 * conversation coherence while keeping most recent context.
 * 
 * Reference: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Counting_Tokens.ipynb
 */
export class ContextWindowService {
  /**
   * Get the safe token limit for a model
   * @param {string} modelName - Model identifier
   * @returns {number} Safe token limit
   */
  static getSafeLimit(modelName) {
    return getSafeLimit(modelName);
  }

  /**
   * Get the maximum token limit for a model
   * @param {string} modelName - Model identifier
   * @returns {number} Maximum token limit
   */
  static getMaxLimit(modelName) {
    return getMaxLimit(modelName);
  }

  /**
   * Get complete model limits information
   * @param {string} modelName - Model identifier
   * @returns {Object} { max, safe, description }
   */
  static getModelInfo(modelName) {
    return getModelLimits(modelName);
  }

  /**
   * Count total tokens in a conversation
   * @param {string} systemMessage - System prompt
   * @param {Array} messages - Array of {role, content} message objects
   * @param {string} modelName - Model identifier
   * @returns {Promise<number>} Total token count
   */
  static async countConversationTokens(systemMessage, messages, modelName) {
    try {
      // Build full conversation text as it would be sent to the model
      const conversationParts = [];
      
      // Add system message if present
      if (systemMessage) {
        conversationParts.push(`System: ${systemMessage}`);
      }

      // Add all messages
      if (messages && messages.length > 0) {
        for (const msg of messages) {
          conversationParts.push(`${msg.role}: ${msg.content}`);
        }
      }

      const fullConversation = conversationParts.join('\n\n');
      
      // Count tokens using the token counting service
      const tokenCount = await tokenCountingService.countTokens(fullConversation, modelName);

      logger.debug('Conversation token count:', {
        modelName,
        messageCount: messages?.length || 0,
        tokenCount,
        hasSystemMessage: !!systemMessage
      });

      return tokenCount;
    } catch (error) {
      logger.error('Error counting conversation tokens:', {
        error: error.message,
        modelName,
        messageCount: messages?.length || 0
      });
      // Fallback to estimation if accurate counting fails
      const fullText = systemMessage + (messages?.map(m => m.content).join('') || '');
      return tokenCountingService.estimateTokens(fullText);
    }
  }

  /**
   * Check if conversation needs truncation
   * @param {string} systemMessage - System prompt
   * @param {Array} messages - Array of message objects
   * @param {string} modelName - Model identifier
   * @returns {Promise<Object>} { needsTruncation, currentTokens, safeLimit }
   */
  static async checkNeedsTruncation(systemMessage, messages, modelName) {
    const currentTokens = await this.countConversationTokens(systemMessage, messages, modelName);
    const safeLimit = this.getSafeLimit(modelName);
    const needsTruncation = exceedsSafeLimit(currentTokens, modelName);

    return {
      needsTruncation,
      currentTokens,
      safeLimit,
      maxLimit: this.getMaxLimit(modelName),
      overage: needsTruncation ? currentTokens - safeLimit : 0
    };
  }

  /**
   * Truncate conversation to fit within safe token limit
   * Removes oldest message pairs while preserving system message and recent context
   * 
   * @param {string} systemMessage - System prompt (always preserved)
   * @param {Array} messages - Array of {role, content} message objects
   * @param {string} modelName - Model identifier
   * @returns {Promise<Object>} { truncatedMessages, tokensRemoved, messagesRemoved, finalTokens }
   */
  static async truncateConversation(systemMessage, messages, modelName) {
    const safeLimit = this.getSafeLimit(modelName);
    const startTime = Date.now();
    
    // Count initial tokens
    const initialTokens = await this.countConversationTokens(systemMessage, messages, modelName);

    // If already under limit, no truncation needed
    if (initialTokens <= safeLimit) {
      logger.debug('Conversation already within safe limit, no truncation needed:', {
        modelName,
        initialTokens,
        safeLimit
      });
      return {
        truncatedMessages: messages,
        tokensRemoved: 0,
        messagesRemoved: 0,
        finalTokens: initialTokens,
        truncated: false
      };
    }

    logger.info('Starting conversation truncation:', {
      modelName,
      initialMessages: messages.length,
      initialTokens,
      safeLimit,
      overage: initialTokens - safeLimit
    });

    // Start with all messages
    let truncatedMessages = [...messages];
    let currentTokens = initialTokens;
    let messagesRemoved = 0;

    // Remove oldest message pairs until under safe limit
    // We remove in pairs (user + assistant) to maintain conversation coherence
    while (currentTokens > safeLimit && truncatedMessages.length > 1) {
      // Always keep the most recent message (the current user message)
      if (truncatedMessages.length <= 1) {
        break;
      }

      // Remove the oldest message
      const removedMessage = truncatedMessages.shift();
      messagesRemoved++;

      // If we removed a user message and there's an assistant response, remove that too
      // This keeps user-assistant pairs together
      if (removedMessage.role === 'user' && truncatedMessages.length > 0 && truncatedMessages[0].role === 'assistant') {
        truncatedMessages.shift();
        messagesRemoved++;
      }

      // Recount tokens
      currentTokens = await this.countConversationTokens(systemMessage, truncatedMessages, modelName);

      logger.debug('Truncation iteration:', {
        messagesRemaining: truncatedMessages.length,
        currentTokens,
        messagesRemoved
      });
    }

    const finalTokens = currentTokens;
    const tokensRemoved = initialTokens - finalTokens;
    const duration = Date.now() - startTime;

    logger.info('Conversation truncation completed:', {
      modelName,
      initialMessages: messages.length,
      finalMessages: truncatedMessages.length,
      messagesRemoved,
      initialTokens,
      finalTokens,
      tokensRemoved,
      safeLimit,
      underLimit: finalTokens <= safeLimit,
      durationMs: duration
    });

    // If still over limit after removing all but last message, log warning
    if (finalTokens > safeLimit) {
      logger.warn('Unable to truncate below safe limit:', {
        modelName,
        finalMessages: truncatedMessages.length,
        finalTokens,
        safeLimit,
        remainingOverage: finalTokens - safeLimit
      });
    }

    return {
      truncatedMessages,
      tokensRemoved,
      messagesRemoved,
      finalTokens,
      truncated: messagesRemoved > 0,
      durationMs: duration
    };
  }

  /**
   * Prepare conversation for AI request with automatic truncation
   * This is the main method to use before sending to AI models
   * 
   * @param {string} systemMessage - System prompt
   * @param {Array} messages - Array of message objects
   * @param {string} modelName - Model identifier
   * @returns {Promise<Object>} { messages, metadata }
   */
  static async prepareConversation(systemMessage, messages, modelName) {
    const checkResult = await this.checkNeedsTruncation(systemMessage, messages, modelName);

    if (!checkResult.needsTruncation) {
      logger.debug('Conversation within limits, no preparation needed:', {
        modelName,
        tokens: checkResult.currentTokens,
        safeLimit: checkResult.safeLimit
      });

      return {
        messages,
        metadata: {
          truncated: false,
          originalTokens: checkResult.currentTokens,
          finalTokens: checkResult.currentTokens,
          messagesRemoved: 0,
          tokensRemoved: 0
        }
      };
    }

    // Truncate conversation
    const truncationResult = await this.truncateConversation(systemMessage, messages, modelName);

    return {
      messages: truncationResult.truncatedMessages,
      metadata: {
        truncated: true,
        originalMessages: messages.length,
        finalMessages: truncationResult.truncatedMessages.length,
        messagesRemoved: truncationResult.messagesRemoved,
        originalTokens: checkResult.currentTokens,
        finalTokens: truncationResult.finalTokens,
        tokensRemoved: truncationResult.tokensRemoved,
        safeLimit: checkResult.safeLimit,
        durationMs: truncationResult.durationMs
      }
    };
  }
}

