// src/services/ai/aiService.js
import { OpenAIAdapter } from '../../adapters/openAiAdapter.js';
import { AnthropicAdapter } from '../../adapters/anthropicAdapter.js';
import { FirefallAdapter } from '../../adapters/firefallAdapter.js';
import { GoogleAdapter } from '../../adapters/googleAdapter.js';
import { logger } from '../logger.js';

/**
 * AiService is responsible for returning the correct adapter based on
 * the "provider" type and calling the appropriate generate/generateStream methods.
 */
class AiService {
  constructor() {
    this.adapters = {
      openai: OpenAIAdapter,
      anthropic: AnthropicAdapter,
      firefall: FirefallAdapter,
      google: GoogleAdapter,
    };
  }

  getAdapter(provider, config) {
    const AdapterClass = this.adapters[provider];
    if (!AdapterClass) {
      throw new Error(`Unsupported AI provider: ${provider}`);
    }
    return new AdapterClass(config);
  }

  // Example method if you do a non-streaming call:
  async generate(adapter, prompt, model, temperature, maxTokens) {
    try {
      const response = await adapter.generate({
        prompt,
        model,
        temperature,
        maxTokens,
      });
      return response;
    } catch (error) {
      logger.error('AI generation failed:', {
        error: error.message,
        provider: adapter.provider,
      });
      throw error;
    }
  }
}

export const aiService = new AiService();
