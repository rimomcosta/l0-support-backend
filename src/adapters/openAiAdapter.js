// src/adapters/openAiAdapter.js
import OpenAI from 'openai';
import { logger } from '../services/logger.js';

/**
 * Example usage of the OpenAI API client. We assume you have `openai` installed.
 * We add a `generateStream` method to handle partial streaming of tokens.
 */
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

  /**
   * If you just want the final text (non-streaming), use "generateCode".
   * This returns a single string of text once complete.
   */
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

  /**
   * For a chatbot, we typically want streaming partial tokens.
   * This method returns an object with an async "stream" generator
   * we can iterate over to get partial tokens from OpenAI.
   */
  async generateStream({ model, messages, systemMessage, temperature, maxTokens }) {
    try {
      // The "messages" param might already include a system prompt.
      // If you prefer to insert a system prompt here, do so carefully.
      const finalMessages = messages || [
        {
          role: 'system',
          content: systemMessage || 'You are a helpful assistant!',
        },
      ];

      // Create the streaming request
      const response = await this.openai.chat.completions.create({
        model: model || this.model,
        messages: finalMessages,
        max_tokens: maxTokens ?? this.maxTokens,
        temperature: temperature ?? this.temperature,
        stream: true,
      });

      /**
       * "response" is an async iterator that yields partial data events.
       * We'll wrap it in our own async generator to extract the tokens.
       */
      const streamIterator = this._readStreamingResponse(response);
      return { stream: streamIterator };
    } catch (error) {
      logger.error('Error generating stream with OpenAI:', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Private helper that consumes the "response" from openai.chat.completions.create({ stream: true })
   * and yields partial tokens as plain text.
   */
  async *_readStreamingResponse(response) {
    for await (const part of response) {
      // "part" might look like:
      // {
      //   "id": "chatcmpl-abc123",
      //   "object": "chat.completion.chunk",
      //   "created": 1234567890,
      //   "model": "gpt-4-0613",
      //   "choices": [
      //     {
      //       "delta": {"content": " some partial text"},
      //       "index": 0,
      //       "finish_reason": null
      //     }
      //   ]
      // }
      const content = part.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
