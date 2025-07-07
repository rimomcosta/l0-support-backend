import { logger } from '../services/logger.js';

export class GoogleVertexAdapter {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      logger.error('GoogleVertexAdapter: Missing API key');
      throw new Error('Google Vertex AI API key is required');
    }

    this.provider = 'google';
    this.modelName = config.model || 'gemini-2.5-pro';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 65536;
    this.topP = config.topP ?? 0.95;
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
        topP: data.topP ?? this.topP,
        thinkingConfig: {
          thinkingBudget: -1,
          includeThoughts: true
        }
      };

      // Google Vertex AI requires combining system message and prompt
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
        throw new Error(`Google Vertex AI request failed: ${errText}`);
      }

      const json = await resp.json();
      const parts = json.candidates?.[0]?.content?.parts || [];
      
      // Separate thinking and content parts
      const thinkingParts = parts.filter(part => part.thought).map(part => part.text);
      const contentParts = parts.filter(part => !part.thought).map(part => part.text);
      
      // For non-streaming, we'll return just the content, but this structure allows for future expansion
      return contentParts.join('').trim();
    } catch (error) {
      logger.error('Error generating code with Google Vertex AI:', { error: error.message });
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
          maxOutputTokens: maxTokens ?? this.maxTokens,
          topP: this.topP,
          thinkingConfig: {
            thinkingBudget: -1,
            includeThoughts: true
          }
        }
      };

      // Log AI payload if enabled
      if (process.env.ENABLE_AI_OUTPUT === 'true') {
        console.log('\n === AI REQUEST ===');
        console.log('SYSTEM MESSAGE:');
        console.log(finalSystemMessage);
        console.log('\nCONVERSATION:');
        if (messages && messages.length > 0) {
          messages.forEach(msg => {
            console.log(`${msg.role.toUpperCase()}: ${msg.content}`);
          });
        } else {
          console.log('(no conversation history)');
        }
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
        throw new Error(`Google Vertex AI streaming request failed: ${errText}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');

      return { stream: this._createStreamIterator(reader, decoder, signal) };
    } catch (error) {
      logger.error('Error generating stream with Google Vertex AI:', { error: error.message });
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
      while (!done) {
        // Check for abort signal
        if (signal?.aborted) {
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
            const parts = parsed.candidates[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                const content = {
                  type: part.thought ? 'thinking' : 'content',
                  text: part.text
                };
                
                if (process.env.ENABLE_AI_OUTPUT === 'true') {
                  fullResponse += `[${content.type.toUpperCase()}]: ${content.text}`;
                }
                
                yield content;
              }
            }
          }
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