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
        console.log('\n === AI REQUEST PAYLOAD (OpenAI) ===');
        console.log('Model:', model || this.model);
        console.log('Temperature:', temperature ?? this.temperature);
        console.log('Max Tokens:', maxTokens ?? this.maxTokens);
        console.log('Messages:');
        finalMessages.forEach((msg, idx) => {
          console.log(`  [${idx}] ${msg.role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
        });
        console.log('Full Messages:', JSON.stringify(finalMessages, null, 2));
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
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI REQUEST FAILED (OpenAI) ===');
        console.log('Error:', error.message);
        console.log('=== END AI ERROR ===\n');
      }
      logger.error('Error generating stream with OpenAI:', {
        error: error.message,
      });
      throw error;
    }
  }

  async *_createStreamIterator(stream, signal) {
    let fullResponse = '';
    let isFirstChunk = true;

    try {
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI RESPONSE STREAM START (OpenAI) ===');
      }

      for await (const chunk of stream) {
        // Check for abort signal
        if (signal?.aborted) {
          if (process.env.ENABLE_AI_OUTPUT === 'true') {
            console.log('\n === AI STREAM ABORTED (OpenAI) ===\n');
          }
          break;
        }

        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          if (process.env.ENABLE_AI_OUTPUT === 'true') {
            if (isFirstChunk) {
              console.log('First chunk received:', content);
              isFirstChunk = false;
            }
            fullResponse += content;
          }
          yield content;
        }
      }

      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI RESPONSE COMPLETE (OpenAI) ===');
        console.log('Full Response Length:', fullResponse.length);
        console.log('Full Response:');
        console.log(fullResponse);
        console.log('=== END AI RESPONSE ===\n');
      }
    } catch (error) {
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI STREAM ERROR (OpenAI) ===');
        console.log('Error:', error.message);
        console.log('=== END AI STREAM ERROR ===\n');
      }
      logger.error('Error in stream iterator:', {
        error: error.message,
      });
      throw error;
    }
  }
}