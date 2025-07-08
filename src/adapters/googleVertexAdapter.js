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

      // Enhanced payload analysis for large messages
      const textLength = conversationText.length;
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
      
      const payloadSize = JSON.stringify(payload).length;
      const estimatedTokens = Math.ceil(textLength / 4); // Rough estimate: 1 token ≈ 4 characters
      
      // Check for potentially problematic payload sizes based on research
      const LARGE_PAYLOAD_THRESHOLD = 10 * 1024 * 1024; // 10MB JSON payload
      const VERY_LARGE_TEXT_THRESHOLD = 2 * 1024 * 1024; // 2MB of text (~500k tokens)
      const EXTREME_TEXT_THRESHOLD = 8 * 1024 * 1024; // 8MB of text (~2M tokens)
      
      logger.debug('Google Vertex payload analysis:', {
        model: model || this.modelName,
        textLength,
        payloadSize,
        estimatedTokens,
        messageCount: messages?.length || 0,
        isLargePayload: payloadSize > LARGE_PAYLOAD_THRESHOLD,
        isVeryLargeText: textLength > VERY_LARGE_TEXT_THRESHOLD,
        isExtremeText: textLength > EXTREME_TEXT_THRESHOLD
      });
      
             if (textLength > EXTREME_TEXT_THRESHOLD) {
         const sizeMB = Math.round(textLength / 1024 / 1024 * 100) / 100;
         console.log(`🚨 EXTREME MESSAGE SIZE: ${sizeMB}MB (${estimatedTokens} tokens) - This will likely cause a 500 error!`);
         logger.warn('EXTREME text size detected - this will likely fail with 500 error:', {
           textLength,
           estimatedTokens,
           sizeMB
         });
       } else if (textLength > VERY_LARGE_TEXT_THRESHOLD) {
         const sizeMB = Math.round(textLength / 1024 / 1024 * 100) / 100;
         console.log(`⚠️  LARGE MESSAGE SIZE: ${sizeMB}MB (${estimatedTokens} tokens) - This may cause API issues`);
         logger.warn('Very large text detected - this may cause API issues:', {
           textLength,
           estimatedTokens,
           sizeMB
         });
       }

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
      
      logger.debug('Sending request to Google Vertex AI:', {
        url,
        model: model || this.modelName,
        payloadSize: JSON.stringify(payload).length
      });
      
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      logger.debug('Google Vertex AI response received:', {
        status: resp.status,
        statusText: resp.statusText,
        hasBody: !!resp.body,
        headers: Object.fromEntries(resp.headers.entries())
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => 'Unknown error');
        
        // Try to parse the error response as JSON to get detailed error information
        let parsedError = null;
        try {
          parsedError = JSON.parse(errText);
        } catch (e) {
          // Not JSON, keep as plain text
        }
        
        // Enhanced error analysis for large payloads
        const errorDetails = {
          status: resp.status,
          statusText: resp.statusText,
          headers: Object.fromEntries(resp.headers.entries()),
          errorText: errText,
          parsedError: parsedError,
          payloadSize,
          textLength,
          estimatedTokens,
          sizeMB: Math.round(textLength / 1024 / 1024 * 100) / 100,
          isLargePayload: payloadSize > 10 * 1024 * 1024,
          isVeryLargeText: textLength > 2 * 1024 * 1024,
          isExtremeText: textLength > 8 * 1024 * 1024
        };
        
        console.log('🔍 DETAILED API ERROR RESPONSE:');
        console.log('Status:', resp.status, resp.statusText);
        console.log('Headers:', Object.fromEntries(resp.headers.entries()));
        console.log('Raw Error:', errText);
        if (parsedError) {
          console.log('Parsed Error:', JSON.stringify(parsedError, null, 2));
        }
        console.log('Message Size:', Math.round(textLength / 1024 / 1024 * 100) / 100, 'MB');
        console.log('Estimated Tokens:', estimatedTokens);
        
        logger.error('Google Vertex AI request failed:', errorDetails);
        
                          // Provide specific error messages based on status and payload size
         // Extract specific error message from API response if available
         let specificErrorMessage = errText;
         if (parsedError) {
           if (parsedError.error?.message) {
             specificErrorMessage = parsedError.error.message;
           } else if (parsedError.message) {
             specificErrorMessage = parsedError.message;
           } else if (parsedError.error?.details) {
             specificErrorMessage = JSON.stringify(parsedError.error.details);
           }
         }
         
         if (resp.status === 500) {
           if (textLength > 2 * 1024 * 1024) {
             const sizeMB = Math.round(textLength / 1024 / 1024 * 100) / 100;
             console.log(`💥 CONFIRMED: Google Vertex AI 500 error for ${sizeMB}MB message (${estimatedTokens} tokens)`);
             throw new Error(
               `Google Vertex AI returned 500 Internal Server Error for very large message (${sizeMB}MB, ~${estimatedTokens} tokens). ` +
               `API Error: "${specificErrorMessage}". ` +
               `This indicates the API has practical limits lower than advertised maximums. ` +
               `Try breaking the content into smaller chunks or summarizing the data first.`
             );
           } else {
             console.log(`💥 Google Vertex AI 500 error for normal-sized message: ${specificErrorMessage}`);
             throw new Error(`Google Vertex AI internal server error (500). API Error: "${specificErrorMessage}"`);
           }
         } else if (resp.status === 413) {
           throw new Error(
             `Request payload too large (${Math.ceil(payloadSize / 1024)}KB). ` +
             `API Error: "${specificErrorMessage}". Content size exceeds API limits.`
           );
         } else if (resp.status === 429) {
           // Check if this is a quota issue specifically
           if (parsedError?.error?.details?.some(detail => 
             detail['@type']?.includes('QuotaFailure') || 
             detail.quotaMetric?.includes('input_token_count')
           )) {
             // Extract quota information for better error handling
             const quotaInfo = parsedError.error.details.find(detail => detail['@type']?.includes('QuotaFailure'));
             const quotaLimit = quotaInfo?.violations?.[0]?.quotaValue || '250000';
             
             throw new Error(
               `quota exceeded: Google Vertex AI FreeTier quota limit reached (${quotaLimit} tokens per minute). ` +
               `Your message (~${estimatedTokens} tokens) exceeds this limit. ` +
               `API response: "${specificErrorMessage}"`
             );
           } else {
             throw new Error(`Rate limit exceeded. API Error: "${specificErrorMessage}". Too many requests to Google Vertex AI.`);
           }
         } else if (resp.status === 400) {
           throw new Error(`Bad request to Google Vertex AI (400). API Error: "${specificErrorMessage}"`);
         } else {
           throw new Error(`Google Vertex AI streaming request failed (${resp.status}). API Error: "${specificErrorMessage}"`);
         }
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
    let totalBytesProcessed = 0;
    let chunksProcessed = 0;
    
    // Safety limits for very large responses
    const MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB buffer limit
    const MAX_CHUNKS = 10000; // Maximum chunks to process
    const MAX_CONTENT_SIZE = 100 * 1024 * 1024; // 100MB total content limit

    try {
      logger.debug('Google Vertex stream iterator starting');
      
      while (!done && chunksProcessed < MAX_CHUNKS) {
        // Check for abort signal
        if (signal?.aborted) {
          logger.debug('Stream aborted by signal');
          break;
        }

        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        chunksProcessed++;

        if (value) {
          const chunkSize = value.length;
          totalBytesProcessed += chunkSize;
          
          // Check buffer size limits
          if (buffer.length + chunkSize > MAX_BUFFER_SIZE) {
            logger.warn('Buffer size limit exceeded, processing what we have', {
              bufferSize: buffer.length,
              chunkSize,
              limit: MAX_BUFFER_SIZE
            });
            // Process what we have in buffer before adding more
            let obj;
            while ((obj = this._extractObject(buffer)) !== null) {
              try {
                const parsed = JSON.parse(obj.raw);
                buffer = buffer.slice(obj.endPos);
                
                if (parsed.candidates?.length > 0) {
                  const parts = parsed.candidates[0]?.content?.parts || [];
                  for (const part of parts) {
                    if (part.text) {
                      const content = {
                        type: part.thought ? 'thinking' : 'content',
                        text: part.text
                      };
                      
                      // Check content size limits
                      if (fullResponse.length + content.text.length > MAX_CONTENT_SIZE) {
                        logger.warn('Content size limit reached, stopping stream', {
                          currentSize: fullResponse.length,
                          newContentSize: content.text.length,
                          limit: MAX_CONTENT_SIZE
                        });
                        return;
                      }
                      
                      if (process.env.ENABLE_AI_OUTPUT === 'true') {
                        fullResponse += `[${content.type.toUpperCase()}]: ${content.text}`;
                      }
                      
                      yield content;
                    }
                  }
                }
              } catch (parseError) {
                logger.error('Error parsing JSON chunk in overflow handling:', { 
                  error: parseError.message,
                  chunkNumber: chunksProcessed
                });
                buffer = buffer.slice(obj.endPos);
              }
            }
            // Clear buffer if it's still too large
            if (buffer.length > MAX_BUFFER_SIZE / 2) {
              logger.warn('Clearing oversized buffer', { bufferSize: buffer.length });
              buffer = '';
            }
          }
          
          buffer += decoder.decode(value, { stream: true });
          
          if (chunksProcessed % 100 === 0) {
            logger.debug('Stream processing progress', {
              chunksProcessed,
              totalBytesProcessed,
              bufferSize: buffer.length
            });
          }
        }

        // Process complete objects from the buffer
        let obj;
        let objectsProcessed = 0;
        const MAX_OBJECTS_PER_CHUNK = 100; // Limit objects processed per chunk
        
        while ((obj = this._extractObject(buffer)) !== null && objectsProcessed < MAX_OBJECTS_PER_CHUNK) {
          try {
            const parsed = JSON.parse(obj.raw);
            buffer = buffer.slice(obj.endPos);
            objectsProcessed++;

            // Extract and yield text from candidates
            if (parsed.candidates?.length > 0) {
              const parts = parsed.candidates[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.text) {
                  const content = {
                    type: part.thought ? 'thinking' : 'content',
                    text: part.text
                  };
                  
                  // Check content size limits
                  if (fullResponse.length + content.text.length > MAX_CONTENT_SIZE) {
                    logger.warn('Content size limit reached, stopping stream', {
                      currentSize: fullResponse.length,
                      newContentSize: content.text.length,
                      limit: MAX_CONTENT_SIZE
                    });
                    return;
                  }
                  
                  if (process.env.ENABLE_AI_OUTPUT === 'true') {
                    fullResponse += `[${content.type.toUpperCase()}]: ${content.text}`;
                  }
                  
                  yield content;
                }
              }
            }
          } catch (parseError) {
            logger.error('Error parsing JSON chunk:', { 
              error: parseError.message,
              rawChunk: obj.raw.substring(0, 200), // First 200 chars for debugging
              chunkNumber: chunksProcessed,
              objectNumber: objectsProcessed
            });
            // Skip this chunk and continue processing
            buffer = buffer.slice(obj.endPos);
          }
        }
        
        // If we hit the objects per chunk limit, break to allow yielding
        if (objectsProcessed >= MAX_OBJECTS_PER_CHUNK) {
          logger.debug('Hit objects per chunk limit, yielding control', {
            objectsProcessed,
            bufferSize: buffer.length
          });
        }
      }

      logger.debug('Google Vertex stream iterator completed', {
        chunksProcessed,
        totalBytesProcessed,
        finalBufferSize: buffer.length
      });

      if (process.env.ENABLE_AI_OUTPUT === 'true' && fullResponse) {
        console.log('\n === AI RESPONSE ===');
        console.log(fullResponse);
        console.log('=== END AI RESPONSE ===\n');
      }
    } catch (error) {
      console.log(`🔥 STREAM ITERATOR ERROR: ${error.message}`);
      console.log(`   Chunks processed: ${chunksProcessed}, Bytes processed: ${totalBytesProcessed}`);
      logger.error('Error in stream iterator:', { 
        error: error.message, 
        stack: error.stack,
        buffer: buffer.substring(0, 500), // First 500 chars of buffer for debugging
        chunksProcessed,
        totalBytesProcessed
      });
      throw error;
    } finally {
      try {
        reader.releaseLock();
        logger.debug('Stream reader lock released');
      } catch (releaseError) {
        logger.error('Error releasing reader lock:', { error: releaseError.message });
      }
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