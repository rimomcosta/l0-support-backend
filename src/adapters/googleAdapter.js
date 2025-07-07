// src/adapters/googleAdapter.js
import { logger } from '../services/logger.js';

export class GoogleAdapter {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      logger.error('GoogleAdapter: Missing API key');
      throw new Error('Google API key is required');
    }

    this.provider = 'google';
    this.modelName = config.model || 'gemini-1.5-flash';
    this.temperature = config.temperature ?? 0.9;
    this.maxTokens = config.maxTokens ?? 1000;
    this.stream = config.stream ?? false;
    this.systemMessage = config.systemMessage;

    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  async generateCode(data) {
    try {
      const systemMessage = data.systemMessage || this.systemMessage || 'You are a helpful assistant.';
      const generationConfig = {
        temperature: data.temperature ?? this.temperature,
        maxOutputTokens: data.maxTokens ?? this.maxTokens,
      };

      // Google requires combining system message and prompt
      const combinedPrompt = `${systemMessage}\n\n${data.prompt}`;

      const url = `${this.baseUrl}/models/${this.modelName}:generateContent?key=${this.apiKey}`;
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: combinedPrompt }]
          }
        ],
        generationConfig,
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Google Gemini request failed: ${errText}`);
      }

      const json = await resp.json();
      const candidate = json.candidates?.[0]?.content?.parts || [];
      return candidate.map(part => part.text).join('').trim();
    } catch (error) {
      logger.error('Error generating code with Google:', { error: error.message });
      throw error;
    }
  }

  async generateStream({ model, messages, systemMessage, temperature, maxTokens, signal }) {
    try {
      const finalSystemMessage = systemMessage || this.systemMessage || 'You are a helpful assistant.';
      
      // Combine messages into a single context, maintaining conversation flow
      let conversationText = finalSystemMessage + '\n\n';
      
      if (messages && messages.length > 0) {
        messages
          .filter(msg => msg.role !== 'system') // Skip system messages as we already included it
          .forEach(msg => {
            const rolePrefix = msg.role === 'assistant' ? 'Assistant: ' : 'User: ';
            conversationText += `${rolePrefix}${msg.content}\n\n`;
          });
      }

      const payload = {
        contents: [
          {
            parts: [{ text: conversationText.trim() }]
          }
        ],
        generationConfig: {
          temperature: temperature ?? this.temperature,
          maxOutputTokens: maxTokens ?? this.maxTokens
        }
      };

      // Log AI payload if enabled
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI REQUEST PAYLOAD ===');
        console.log('Model:', model || this.modelName);
        console.log('Temperature:', temperature ?? this.temperature);
        console.log('Max Tokens:', maxTokens ?? this.maxTokens);
        console.log('System Message:', finalSystemMessage);
        console.log('Messages:');
        messages?.forEach((msg, idx) => {
          console.log(`  [${idx}] ${msg.role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
        });
        console.log('Full Conversation Text:');
        console.log(conversationText);
        console.log('Raw Payload:', JSON.stringify(payload, null, 2));
        console.log('=== END AI REQUEST ===\n');
      }

      const url = `${this.baseUrl}/models/${model || this.modelName}:streamGenerateContent?key=${this.apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => 'Unknown error');
        if (process.env.ENABLE_AI_OUTPUT === 'true') {
          console.log('\n === AI REQUEST FAILED ===');
          console.log('Status:', resp.status);
          console.log('Error:', errText);
          console.log('=== END AI ERROR ===\n');
        }
        throw new Error(`Google Gemini streaming request failed: ${errText}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');

      return { stream: this._createStreamIterator(reader, decoder, signal) };
    } catch (error) {
      logger.error('Error generating stream with Google:', { error: error.message });
      throw error;
    }
  }

  async *_createStreamIterator(reader, decoder, signal) {
    let buffer = '';
    let done = false;
    let insideArray = false;
    let fullResponse = '';
    let isFirstChunk = true;

    try {
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI RESPONSE STREAM START ===');
      }

      while (!done) {
        // Check for abort signal
        if (signal?.aborted) {
          if (process.env.ENABLE_AI_OUTPUT === 'true') {
            console.log('\n === AI STREAM ABORTED ===\n');
          }
          break;
        }

        const { value, done: doneReading } = await reader.read();
        done = doneReading;

        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        // Process complete objects from the buffer
        let obj;
        while ((obj = this._extractObject(buffer)) !== null) {
          const parsed = JSON.parse(obj.raw);
          buffer = buffer.slice(obj.endPos);

          // Extract and yield text from candidates
          if (parsed.candidates?.length > 0) {
            const text = parsed.candidates[0]?.content?.parts?.[0]?.text;
            if (text) {
              if (process.env.ENABLE_AI_OUTPUT === 'true') {
                if (isFirstChunk) {
                  console.log('First chunk received:', text);
                  isFirstChunk = false;
                }
                fullResponse += text;
              }
              yield text;
            }
          }
        }
      }

      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI RESPONSE COMPLETE ===');
        console.log('Full Response Length:', fullResponse.length);
        console.log('Full Response:');
        console.log(fullResponse);
        console.log('=== END AI RESPONSE ===\n');
      }
    } catch (error) {
      logger.error('Error in stream iterator:', { error: error.message });
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI STREAM ERROR ===');
        console.log('Error:', error.message);
        console.log('=== END AI STREAM ERROR ===\n');
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  _extractObject(buffer) {
    const start = buffer.indexOf('{');
    if (start === -1) return null;

    let braceCount = 0;
    let i = start;
    
    while (i < buffer.length) {
      const char = buffer[i];
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;

      i++;
      if (braceCount === 0) {
        return {
          raw: buffer.slice(start, i),
          endPos: i
        };
      }
    }
    return null;
  }
}