import { VertexAI } from '@google-cloud/vertexai';
import { logger } from '../services/logger.js';

export class GoogleVertexAdapter {
  constructor(config = {}) {
    // Vertex AI configuration
    this.projectId = config.projectId || process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.location = config.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    
    if (!this.projectId) {
      logger.error('GoogleVertexAdapter: Missing Google Cloud Project ID');
      throw new Error('Google Cloud Project ID is required for Vertex AI');
    }

    // Initialize Vertex AI
    try {
      this.vertexAI = new VertexAI({
        project: this.projectId,
        location: this.location,
      });
      
      // Check if this is an Anthropic model
      const modelName = config.model || 'gemini-2.5-pro';
      const isAnthropicModel = modelName.includes('claude') || modelName.includes('anthropic');
      
      if (isAnthropicModel) {
        // For Anthropic models, use the publishers endpoint format
        this.modelEndpoint = `publishers/anthropic/models/${modelName}`;
        logger.info(`GoogleVertexAdapter: Using Anthropic model endpoint: ${this.modelEndpoint}`);
      }
    } catch (error) {
      logger.error('GoogleVertexAdapter: Failed to initialize Vertex AI:', { error: error.message });
      throw new Error(`Failed to initialize Vertex AI: ${error.message}`);
    }

    this.provider = 'google_vertex';
    this.modelName = config.model || 'gemini-2.5-pro';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 65536;
    this.topP = config.topP ?? 0.95;
    this.stream = config.stream ?? false;
    this.systemMessage = config.systemMessage;
  }

  async generateCode(data) {
    try {
      const systemMessage = data.systemMessage || this.systemMessage || 'You are a helpful assistant.';
      const modelName = data.model || this.modelName;
      const isAnthropicModel = modelName.includes('claude') || modelName.includes('anthropic');
      
      if (isAnthropicModel) {
        // Use Anthropic Claude through Vertex AI
        return await this._generateWithAnthropic(data, systemMessage, modelName);
      } else {
        // Use Google Gemini models
        return await this._generateWithGemini(data, systemMessage, modelName);
      }
    } catch (error) {
      logger.error('Error generating code with Google Vertex AI:', { error: error.message });
      throw error;
    }
  }

  async _generateWithGemini(data, systemMessage, modelName) {
    // Create a new model instance with updated config if needed
    const model = this.vertexAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: data.temperature ?? this.temperature,
        maxOutputTokens: data.maxTokens ?? this.maxTokens,
        topP: data.topP ?? this.topP
      },
    });

    // Prepare the prompt with system message
    const prompt = `${systemMessage}\n\n${data.prompt}`;

    // Generate content using Vertex AI SDK
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Extract text from response - Vertex AI SDK format
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return text.trim();
  }

  async _generateWithAnthropic(data, systemMessage, modelName) {
    // Use Vertex AI REST API for Anthropic models
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/global/publishers/anthropic/models/${modelName}:rawPredict`;
    
    const payload = {
      anthropic_version: 'vertex-2023-10-16',
      messages: [{
        role: 'user',
        content: `${systemMessage}\n\n${data.prompt}`
      }],
      max_tokens: data.maxTokens ?? this.maxTokens,
      temperature: data.temperature ?? this.temperature
    };

    // Get access token for authentication
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const accessToken = await auth.getAccessToken();

    logger.debug('Sending request to Anthropic Claude via Vertex AI:', {
      model: modelName,
      endpoint,
      payload: JSON.stringify(payload)
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic Claude request failed: ${errorText}`);
    }

    const result = await response.json();
    
    // Extract text from Anthropic response format
    let text = '';
    if (result.content && Array.isArray(result.content)) {
      // Find the text content
      const textContent = result.content.find(item => item.type === 'text');
      if (textContent && textContent.text) {
        text = textContent.text;
      }
    }
    
    logger.debug('Anthropic Claude response:', {
      resultKeys: Object.keys(result),
      textLength: text.length,
      textPreview: text.substring(0, 100)
    });
    
    return text.trim();
  }

  async generateStream({ model, messages, systemMessage, temperature, maxTokens, signal }) {
    try {
      const finalSystemMessage = systemMessage || this.systemMessage || 'You are a helpful assistant.';
      const modelName = model || this.modelName;
      const isAnthropicModel = modelName.includes('claude') || modelName.includes('anthropic');
      
      if (isAnthropicModel) {
        // Use Anthropic Claude through Vertex AI for streaming
        return await this._generateStreamWithAnthropic({ model: modelName, messages, systemMessage: finalSystemMessage, temperature, maxTokens, signal });
      } else {
        // Use Google Gemini models for streaming
        return await this._generateStreamWithGemini({ model: modelName, messages, systemMessage: finalSystemMessage, temperature, maxTokens, signal });
      }
    } catch (error) {
      logger.error('Error generating stream with Google Vertex AI:', { error: error.message });
      throw error;
    }
  }

  async _generateStreamWithGemini({ model, messages, systemMessage, temperature, maxTokens, signal }) {
    // Combine messages into a single context, maintaining conversation flow
    let conversationText = systemMessage + '\n\n';
    
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
    const estimatedTokens = Math.ceil(textLength / 4); // Rough estimate: 1 token ≈ 4 characters
    
    // Check for potentially problematic payload sizes
    const VERY_LARGE_TEXT_THRESHOLD = 2 * 1024 * 1024; // 2MB of text (~500k tokens)
    const EXTREME_TEXT_THRESHOLD = 8 * 1024 * 1024; // 8MB of text (~2M tokens)
    
    logger.debug('Google Vertex payload analysis:', {
      model,
      textLength,
      estimatedTokens,
      messageCount: messages?.length || 0,
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
      console.log(systemMessage);
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

    // Create a new model instance with updated config
    const generativeModel = this.vertexAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature: temperature ?? this.temperature,
        maxOutputTokens: maxTokens ?? this.maxTokens,
        topP: this.topP,
        thinkingConfig: {
          thinkingBudget: -1,
          includeThoughts: true
        }
      },
    });

    logger.debug('Sending request to Google Vertex AI:', {
      model,
      textLength,
      estimatedTokens
    });

    // Generate streaming content using Vertex AI SDK
    const result = await generativeModel.generateContentStream(conversationText.trim());
    
    return { stream: this._createStreamIterator(result, signal) };
  }

  async _generateStreamWithAnthropic({ model, messages, systemMessage, temperature, maxTokens, signal }) {
    // Combine messages into a single context
    let conversationText = systemMessage + '\n\n';
    
    if (messages && messages.length > 0) {
      messages
        .filter(msg => msg.role !== 'system')
        .forEach(msg => {
          const rolePrefix = msg.role === 'assistant' ? 'Assistant: ' : 'User: ';
          conversationText += `${rolePrefix}${msg.content}\n\n`;
        });
    }

    // Enhanced payload analysis for large messages
    const textLength = conversationText.length;
    const estimatedTokens = Math.ceil(textLength / 4); // Rough estimate: 1 token ≈ 4 characters
    
    // Check for potentially problematic payload sizes
    const VERY_LARGE_TEXT_THRESHOLD = 2 * 1024 * 1024; // 2MB of text (~500k tokens)
    const EXTREME_TEXT_THRESHOLD = 8 * 1024 * 1024; // 8MB of text (~2M tokens)
    
    logger.debug('Anthropic Claude payload analysis:', {
      model,
      textLength,
      estimatedTokens,
      messageCount: messages?.length || 0,
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
      console.log(systemMessage);
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

    // Use Vertex AI REST API for Anthropic streaming with SSE
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/global/publishers/anthropic/models/${model}:streamRawPredict`;
    
    const payload = {
      anthropic_version: 'vertex-2023-10-16',
      messages: [{
        role: 'user',
        content: conversationText.trim()
      }],
      max_tokens: maxTokens ?? this.maxTokens,
      temperature: temperature ?? this.temperature,
      stream: true
    };

    // Get access token for authentication
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const accessToken = await auth.getAccessToken();

    logger.debug('Sending streaming request to Anthropic Claude via Vertex AI:', {
      model,
      textLength,
      estimatedTokens
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic Claude streaming request failed: ${errorText}`);
    }

    // Return streaming response
    return { stream: this._createAnthropicStreamIterator(response.body, signal) };
  }

  async *_createStreamIterator(streamResult, signal) {
    let fullResponse = '';
    let chunksProcessed = 0;
    
    // Safety limits for very large responses
    const MAX_CHUNKS = 10000; // Maximum chunks to process
    const MAX_CONTENT_SIZE = 100 * 1024 * 1024; // 100MB total content limit

    try {
      logger.debug('Google Vertex stream iterator starting');
      
      for await (const chunk of streamResult.stream) {
        // Check for abort signal
        if (signal?.aborted) {
          logger.debug('Stream aborted by signal');
          break;
        }

        chunksProcessed++;
        
        // Check chunk limits
        if (chunksProcessed > MAX_CHUNKS) {
          logger.warn('Maximum chunks processed, stopping stream', {
            chunksProcessed,
            limit: MAX_CHUNKS
          });
          break;
        }

        // Extract content from the chunk - Vertex AI SDK format
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        
        for (const part of parts) {
          if (part.text) {
            // Check content size limits
            if (fullResponse.length + part.text.length > MAX_CONTENT_SIZE) {
              logger.warn('Content size limit reached, stopping stream', {
                currentSize: fullResponse.length,
                newContentSize: part.text.length,
                limit: MAX_CONTENT_SIZE
              });
              break;
            }
            
            if (process.env.ENABLE_AI_OUTPUT === 'true') {
              fullResponse += part.text;
            }
            
            // Determine content type based on thinking flag
            const contentType = part.thought ? 'thinking' : 'content';
            
            // Yield content with type information
            yield {
              type: contentType,
              text: part.text
            };
          }
        }
        
        if (chunksProcessed % 100 === 0) {
          logger.debug('Stream processing progress', {
            chunksProcessed,
            totalContentSize: fullResponse.length
          });
        }
      }

      logger.debug('Google Vertex stream iterator completed', {
        chunksProcessed,
        totalContentSize: fullResponse.length
      });

      if (process.env.ENABLE_AI_OUTPUT === 'true' && fullResponse) {
        console.log('\n === AI RESPONSE ===');
        console.log(fullResponse);
        console.log('=== END AI RESPONSE ===\n');
      }
    } catch (error) {
      console.log(`🔥 STREAM ITERATOR ERROR: ${error.message}`);
      console.log(`   Chunks processed: ${chunksProcessed}`);
      logger.error('Error in stream iterator:', { 
        error: error.message, 
        stack: error.stack,
        chunksProcessed,
        totalContentSize: fullResponse.length
      });
      throw error;
    }
  }

  async *_createAnthropicStreamIterator(responseBody, signal) {
    let buffer = '';
    let fullResponse = '';
    let chunksProcessed = 0;
    
    // Safety limits for very large responses
    const MAX_CHUNKS = 10000; // Maximum chunks to process
    const MAX_CONTENT_SIZE = 100 * 1024 * 1024; // 100MB total content limit

    try {
      logger.debug('Anthropic Claude stream iterator starting');
      
      const reader = responseBody.getReader();
      const decoder = new TextDecoder('utf-8');
      
      while (chunksProcessed < MAX_CHUNKS) {
        // Check for abort signal
        if (signal?.aborted) {
          logger.debug('Anthropic stream aborted by signal');
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;
        
        chunksProcessed++;
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines from the buffer
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') {
              logger.debug('Anthropic Claude stream completed');
              break;
            }
            
            try {
              const parsed = JSON.parse(jsonStr);
              
              // Extract content from Anthropic SSE format
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                const text = parsed.delta.text;
                
                // Check content size limits
                if (fullResponse.length + text.length > MAX_CONTENT_SIZE) {
                  logger.warn('Content size limit reached, stopping stream', {
                    currentSize: fullResponse.length,
                    newContentSize: text.length,
                    limit: MAX_CONTENT_SIZE
                  });
                  break;
                }
                
                if (process.env.ENABLE_AI_OUTPUT === 'true') {
                  fullResponse += text;
                }
                
                // Yield content with type information
                yield {
                  type: 'content',
                  text: text
                };
              } else if (parsed.type === 'message_start') {
                // Message started
                logger.debug('Anthropic Claude message started');
              } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
                // Message completed
                logger.debug('Anthropic Claude message completed:', parsed.delta.stop_reason);
              } else if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'text') {
                // Content block started
                logger.debug('Anthropic Claude content block started');
              } else if (parsed.type === 'content_block_stop') {
                // Content block completed
                logger.debug('Anthropic Claude content block completed');
              }
            } catch (parseError) {
              logger.error('Error parsing Anthropic stream chunk:', { 
                error: parseError.message,
                chunk: jsonStr.substring(0, 200)
              });
            }
          }
        }
        
        if (chunksProcessed % 100 === 0) {
          logger.debug('Anthropic stream processing progress', {
            chunksProcessed,
            totalContentSize: fullResponse.length
          });
        }
      }
      
      logger.debug('Anthropic Claude stream iterator completed', {
        chunksProcessed,
        totalContentSize: fullResponse.length
      });

      if (process.env.ENABLE_AI_OUTPUT === 'true' && fullResponse) {
        console.log('\n === AI RESPONSE ===');
        console.log(fullResponse);
        console.log('=== END AI RESPONSE ===\n');
      }
      
    } catch (error) {
      console.log(`🔥 ANTHROPIC STREAM ITERATOR ERROR: ${error.message}`);
      console.log(`   Chunks processed: ${chunksProcessed}`);
      logger.error('Error in Anthropic stream iterator:', { 
        error: error.message, 
        stack: error.stack,
        chunksProcessed,
        totalContentSize: fullResponse.length
      });
      throw error;
    }
  }

} 