import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../services/logger.js';

export class AnthropicAdapter {
  constructor(config = {}) {
    this.anthropic = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.provider = 'anthropic';
    this.model = config.model || 'claude-3-7-sonnet-20250219';
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

  async generateStream({ model, messages, systemMessage, temperature, maxTokens, signal }) {
    try {
      // Convert messages array to Anthropic's format, keeping all content
      const formattedMessages = messages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        }));

      // Log AI payload if enabled
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI REQUEST ===');
        console.log('SYSTEM MESSAGE:');
        console.log(systemMessage);
        console.log('\nCONVERSATION:');
        if (formattedMessages.length > 0) {
          formattedMessages.forEach((msg) => {
            console.log(`${msg.role.toUpperCase()}: ${msg.content}`);
          });
        } else {
          console.log('(no conversation history)');
        }
        console.log('=== END AI REQUEST ===\n');
      }

      const stream = await this.anthropic.messages.create({
        model: model || this.model,
        system: systemMessage, // Pass the system message directly here
        messages: formattedMessages,
        temperature: temperature ?? this.temperature,
        max_tokens: maxTokens ?? this.maxTokens,
        stream: true,
      });

      return {
        stream: this._createStreamIterator(stream, signal)
      };
    } catch (error) {
      logger.error('Error generating stream with Anthropic:', { error: error.message });
      throw error;
    }
  }

  async *_createStreamIterator(stream, signal) {
    let fullResponse = '';

    try {
      for await (const chunk of stream) {
        // Check for abort signal
        if (signal?.aborted) {
          break;
        }

        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          if (process.env.ENABLE_AI_OUTPUT === 'true') {
            fullResponse += chunk.delta.text;
          }
          yield chunk.delta.text;
        }
      }

      if (process.env.ENABLE_AI_OUTPUT === 'true' && fullResponse) {
        console.log('\n === AI RESPONSE ===');
        console.log(fullResponse);
        console.log('=== END AI RESPONSE ===\n');
      }
    } catch (error) {
      logger.error('Error in stream iterator:', { error: error.message });
      throw error;
    }
  }
}