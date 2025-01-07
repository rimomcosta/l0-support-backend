import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../services/logger.js';

export class AnthropicAdapter {
  constructor(config = {}) {
    this.anthropic = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.provider = 'anthropic';
    this.model = config.model || 'claude-3-5-sonnet-20241022';
    this.temperature = config.temperature ?? 0.9;
    this.maxTokens = config.maxTokens ?? 1000;
    this.stream = config.stream ?? false;
  }

  async generateCode(data) {
    try {
      const response = await this.anthropic.messages.create({
        model: data.model || this.model,
        system: data.systemMessage,
        messages: [{ role: 'user', content: data.prompt }],
        temperature: data.temperature ?? this.temperature,
        max_tokens: data.maxTokens ?? this.maxTokens,
      });

      return response.content[0].text;
    } catch (error) {
      logger.error('Error generating code with Anthropic:', { error: error.message });
      throw error;
    }
  }

  async generateStream({ model, messages, systemMessage, temperature, maxTokens }) {
    try {
      // Convert messages array to Anthropic's format, keeping all content
      const formattedMessages = messages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        }));

      const stream = await this.anthropic.messages.create({
        model: model || this.model,
        system: systemMessage, // Pass the system message directly here
        messages: formattedMessages,
        temperature: temperature ?? this.temperature,
        max_tokens: maxTokens ?? this.maxTokens,
        stream: true,
      });

      return {
        stream: this._createStreamIterator(stream)
      };
    } catch (error) {
      logger.error('Error generating stream with Anthropic:', { error: error.message });
      throw error;
    }
  }

  async *_createStreamIterator(stream) {
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          yield chunk.delta.text;
        }
      }
    } catch (error) {
      logger.error('Error in stream iterator:', { error: error.message });
      throw error;
    }
  }
}