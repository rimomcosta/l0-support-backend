// src/services/tokenCountingService.js
import { VertexAI } from '@google-cloud/vertexai';
import { logger } from './logger.js';

class TokenCountingService {
  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    
    if (this.projectId) {
      try {
        this.vertexAI = new VertexAI({
          project: this.projectId,
          location: this.location,
        });
      } catch (error) {
        logger.warn('Failed to initialize Vertex AI for token counting:', error.message);
        this.vertexAI = null;
      }
    } else {
      logger.warn('GOOGLE_CLOUD_PROJECT_ID not set, token counting will use estimation');
      this.vertexAI = null;
    }
  }

  /**
   * Count tokens accurately using Vertex AI SDK (for Gemini models)
   * @param {string|Array} content - Text content or array of message objects
   * @param {string} model - Model name (e.g., 'gemini-2.5-pro')
   * @returns {Promise<number>} Token count
   */
  async countTokensAccurate(content, model = 'gemini-2.5-pro') {
    try {
      if (!this.vertexAI) {
        // Fallback to estimation if Vertex AI not available
        return this.estimateTokens(content);
      }

      // Convert content to appropriate format
      let textToCount;
      if (Array.isArray(content)) {
        // If content is an array of messages, concatenate them
        textToCount = content.map(msg => {
          if (typeof msg === 'object' && msg.content) {
            return msg.content;
          }
          return String(msg);
        }).join('\n');
      } else {
        textToCount = String(content);
      }

      // Get the generative model
      const generativeModel = this.vertexAI.getGenerativeModel({
        model: model
      });

      // Count tokens using the SDK
      const result = await generativeModel.countTokens(textToCount);
      const tokenCount = result.totalTokens || 0;

      logger.debug('Token count (accurate):', {
        model,
        textLength: textToCount.length,
        tokenCount
      });

      return tokenCount;
    } catch (error) {
      logger.warn('Failed to count tokens accurately, using estimation:', error.message);
      return this.estimateTokens(content);
    }
  }

  /**
   * Estimate tokens using character-based heuristic
   * @param {string|Array} content - Text content or array of messages
   * @returns {number} Estimated token count
   */
  estimateTokens(content) {
    try {
      let textLength;

      if (Array.isArray(content)) {
        // If content is an array of messages, concatenate them
        textLength = content.map(msg => {
          if (typeof msg === 'object' && msg.content) {
            return msg.content;
          }
          return String(msg);
        }).join('\n').length;
      } else {
        textLength = String(content).length;
      }

      // Estimation: 1 token ≈ 4 characters for English text
      // This is a rough approximation but works reasonably well
      const estimatedTokens = Math.ceil(textLength / 4);

      logger.debug('Token count (estimated):', {
        textLength,
        estimatedTokens
      });

      return estimatedTokens;
    } catch (error) {
      logger.error('Failed to estimate tokens:', error.message);
      return 0;
    }
  }

  /**
   * Count tokens for messages array (chat format)
   * @param {Array} messages - Array of message objects with role and content
   * @param {string} model - Model name
   * @returns {Promise<number>} Token count
   */
  async countTokensForMessages(messages, model = 'gemini-2.5-pro') {
    try {
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return 0;
      }

      // Format messages for token counting
      const formattedContent = messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');

      return await this.countTokensAccurate(formattedContent, model);
    } catch (error) {
      logger.error('Failed to count tokens for messages:', error.message);
      return this.estimateTokens(messages);
    }
  }

  /**
   * Count tokens for a prompt with system message
   * @param {string} systemMessage - System message
   * @param {string} prompt - User prompt
   * @param {string} model - Model name
   * @returns {Promise<number>} Token count
   */
  async countTokensForPrompt(systemMessage, prompt, model = 'gemini-2.5-pro') {
    try {
      const combinedContent = `${systemMessage}\n\n${prompt}`;
      return await this.countTokensAccurate(combinedContent, model);
    } catch (error) {
      logger.error('Failed to count tokens for prompt:', error.message);
      return this.estimateTokens(combinedContent);
    }
  }

  /**
   * Count tokens for streaming response chunks
   * @param {Array<string>} chunks - Array of response chunks
   * @returns {number} Estimated token count
   */
  countTokensForChunks(chunks) {
    try {
      if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
        return 0;
      }

      const combinedText = chunks.join('');
      return this.estimateTokens(combinedText);
    } catch (error) {
      logger.error('Failed to count tokens for chunks:', error.message);
      return 0;
    }
  }

  /**
   * Count tokens for Claude models (approximation)
   * Claude uses different tokenization, so we use a slightly different ratio
   * @param {string|Array} content - Text content
   * @returns {number} Estimated token count
   */
  estimateTokensClaude(content) {
    try {
      let textLength;

      if (Array.isArray(content)) {
        textLength = content.map(msg => {
          if (typeof msg === 'object' && msg.content) {
            return msg.content;
          }
          return String(msg);
        }).join('\n').length;
      } else {
        textLength = String(content).length;
      }

      // Claude: 1 token ≈ 3.5 characters (slightly more tokens than Gemini)
      const estimatedTokens = Math.ceil(textLength / 3.5);

      logger.debug('Token count for Claude (estimated):', {
        textLength,
        estimatedTokens
      });

      return estimatedTokens;
    } catch (error) {
      logger.error('Failed to estimate Claude tokens:', error.message);
      return 0;
    }
  }

  /**
   * Get appropriate token counting method based on model
   * @param {string|Array} content - Text content
   * @param {string} model - Model name
   * @returns {Promise<number>} Token count
   */
  async countTokens(content, model = 'gemini-2.5-pro') {
    // Check if it's a Claude model
    if (model.includes('claude') || model.includes('anthropic')) {
      return this.estimateTokensClaude(content);
    }

    // For Gemini models, use accurate counting
    return await this.countTokensAccurate(content, model);
  }
}

export const tokenCountingService = new TokenCountingService();

