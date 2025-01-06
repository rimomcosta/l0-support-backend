// src/adapters/openAiAdapter.js
import OpenAI from 'openai';
import { logger } from '../services/logger.js';

export class OpenAIAdapter {
  constructor(config = {}) {
    // Create the client using either a config key or env var
    this.openai = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
    });
    this.provider = 'openai';
    this.model = config.model || 'gpt-4o-mini';
    this.temperature = config.temperature ?? 0.9;
    this.maxTokens = config.maxTokens ?? 1000;
    this.stream = config.stream ?? false;
  }

  async generateCode(data) {
    try {
      const response = await this.openai.chat.completions.create({
        model: data.model || this.model,
        messages: [
          {
            role: 'system',
            content: data.systemMessage || 'You are a helpful assistant!',
          },
          {
            role: 'user',
            content: data.prompt,
          },
        ],
        max_tokens: data.maxTokens || this.maxTokens,
        temperature: data.temperature || this.temperature,
        stream: false, // This is the final mode
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Error generating code with OpenAI:', {
        error: error.message,
      });
      throw error;
    }
  }


  async generateStream({ model, messages, systemMessage, temperature, maxTokens }) {
    try {

      const finalMessages = messages || [
        {
          role: 'system',
          content: systemMessage || 'You are a helpful assistant!',
        },
      ];

      const response = await this.openai.chat.completions.create({
        model: model || this.model,
        messages: finalMessages,
        max_tokens: maxTokens ?? this.maxTokens,
        temperature: temperature ?? this.temperature,
        stream: true,
      });

      const streamIterator = this._readStreamingResponse(response);
      return { stream: streamIterator };
    } catch (error) {
      logger.error('Error generating stream with OpenAI:', {
        error: error.message,
      });
      throw error;
    }
  }

  async *_readStreamingResponse(response) {
    for await (const part of response) {
      const content = part.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
