// src/adapters/openAiAdapter.js
import OpenAI from 'openai';
import { logger } from '../services/logger.js';

export class OpenAIAdapter {
  constructor(config = {}) {
    this.openai = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
    });
    this.provider = 'openai';
    this.model = config.model || 'gpt-4o-mini';
    this.temperature = config.temperature ?? 0.9;
    this.maxTokens = config.maxTokens ?? 1000;
    this.stream = config.stream ?? false;
    this.systemMessage = config.systemMessage;
  }

  async generateCode(data) {
    try {
      const response = await this.openai.chat.completions.create({
        model: data.model || this.model,
        messages: [
          {
            role: 'system',
            content: data.systemMessage || this.systemMessage || 'You are a helpful assistant!',
          },
          {
            role: 'user',
            content: data.prompt,
          },
        ],
        max_tokens: data.maxTokens || this.maxTokens,
        temperature: data.temperature || this.temperature,
        stream: false,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Error generating code with OpenAI:', {
        error: error.message,
      });
      throw error;
    }
  }

  async generateStream({ model, messages, systemMessage, temperature, maxTokens, signal }) {
    try {
      // Ensure system message is first in the messages array
      const finalMessages = [
        {
          role: 'system',
          content: systemMessage || this.systemMessage || 'You are a helpful assistant!',
        },
        ...(messages || [])
      ];

      // Log AI payload if enabled
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI REQUEST ===');
        finalMessages.forEach((msg) => {
          if (msg.role === 'system') {
            console.log('SYSTEM MESSAGE:');
            console.log(msg.content);
          } else {
            console.log(`${msg.role.toUpperCase()}: ${msg.content}`);
          }
        });
        console.log('=== END AI REQUEST ===\n');
      }

      const stream = await this.openai.chat.completions.create({
        model: model || this.model,
        messages: finalMessages,
        max_tokens: maxTokens ?? this.maxTokens,
        temperature: temperature ?? this.temperature,
        stream: true,
      });

      return { stream: this._createStreamIterator(stream, signal) };
    } catch (error) {
      logger.error('Error generating stream with OpenAI:', {
        error: error.message,
      });
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

        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          if (process.env.ENABLE_AI_OUTPUT === 'true') {
            fullResponse += content;
          }
          yield content;
        }
      }

      if (process.env.ENABLE_AI_OUTPUT === 'true' && fullResponse) {
        console.log('\n === AI RESPONSE ===');
        console.log(fullResponse);
        console.log('=== END AI RESPONSE ===\n');
      }
    } catch (error) {
      logger.error('Error in stream iterator:', {
        error: error.message,
      });
      throw error;
    }
  }
}