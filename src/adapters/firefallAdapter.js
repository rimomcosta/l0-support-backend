// src/adapters/firefallAdapter.js
import { logger } from '../services/logger.js';
import fetch from 'node-fetch';
import readline from 'readline';

export class FirefallAdapter {
    constructor(config = {}) {
        this.provider = 'firefall';

        // Firefall configuration
        this.baseUrl = config.baseUrl || process.env.FIREFALL_URL || 'https://firefall-stage.adobe.io';
        this.imsEndpoint = config.imsEndpoint || process.env.FIREFALL_IMS_ENDPOINT || 'https://ims-na1-stg1.adobelogin.com/ims/token/v4';
        this.clientId = config.clientId || process.env.FIREFALL_CLIENT_ID;
        this.clientSecret = config.clientSecret || process.env.FIREFALL_CLIENT_SECRET;
        this.imsOrgId = config.imsOrgId || process.env.FIREFALL_IMS_ORG_ID;
        this.authCode = config.authCode || process.env.FIREFALL_AUTH_CODE;

        // LLM configuration
        this.model = config.model || 'gpt-4o-mini';
        this.temperature = config.temperature ?? 0.9;
        this.maxTokens = config.maxTokens ?? 1000;
        this.stream = config.stream ?? false;
        this.systemMessage = config.systemMessage;

        if (!this.clientId || !this.clientSecret || !this.imsOrgId || !this.authCode) {
            logger.error('FirefallAdapter: Missing required configuration');
            throw new Error('Missing required Firefall configuration');
        }

        this.accessToken = null;
        this.tokenExpiresAt = null;
    }

    /**
     * Initializes the adapter by acquiring an access token if necessary.
     */
    async initialize() {
        if (!this.accessToken || this.isTokenExpired()) {
            await this.getAccessToken();
        }
    }

    /**
     * Checks if the current access token is expired.
     */
    isTokenExpired() {
        return this.tokenExpiresAt ? Date.now() >= this.tokenExpiresAt : true;
    }

    /**
     * Acquires a new access token from Firefall's IMS.
     */
    async getAccessToken() {
        try {
            const params = new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: this.authCode
            });

            const response = await fetch(this.imsEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to get access token: ${response.status} ${response.statusText}, Error: ${errorText}`);
            }

            const data = await response.json();
            this.accessToken = data.access_token;
            this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // Refresh 1 minute before expiry

            logger.info('FirefallAdapter: Successfully acquired access token', { expires_in: data.expires_in });
            return this.accessToken;

        } catch (error) {
            logger.error('FirefallAdapter: Token acquisition failed', { error: error.message });
            throw error;
        }
    }

    async generateCode(data) {
        try {
            await this.initialize();

            const requestBody = {
                messages: [
                    {
                        role: 'system',
                        content: data.systemMessage || this.systemMessage || 'You are a helpful assistant that generates code.',
                    },
                    {
                        role: 'user',
                        content: data.prompt,
                    },
                ],
                llm_metadata: {
                    model_name: data.model || this.model,
                    temperature: data.temperature ?? this.temperature,
                    max_tokens: data.maxTokens ?? this.maxTokens,
                    llm_type: 'azure_chat_openai',
                    stream: false,
                },
                store_context: true
            };

            const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.clientId,
                    'x-gw-ims-org-id': this.imsOrgId,
                    'Authorization': `Bearer ${this.accessToken}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                if (response.status === 401) {
                    await this.getAccessToken();
                    return this.generateCode(data);
                }
                throw new Error(`Firefall API error: ${response.status} ${response.statusText}`);
            }

            const responseData = await response.json();
            return this._extractTextFromResponse(responseData);

        } catch (error) {
            logger.error('FirefallAdapter: Code generation failed', { error: error.message });
            throw error;
        }
    }

    async generateStream({ model, messages, systemMessage, temperature, maxTokens }) {
console.log('generateStream======>'+systemMessage);
        try {
            await this.initialize();

            // Ensure system message is first in the messages array
            const finalMessages = [
                {
                    role: 'system',
                    content: systemMessage || this.systemMessage || 'You are a helpful assistant!',
                },
                ...(messages || []).filter(msg => msg.role !== 'system')
            ];

            const requestBody = {
                messages: finalMessages,
                llm_metadata: {
                    model_name: model || this.model,
                    temperature: temperature ?? this.temperature,
                    max_tokens: maxTokens ?? this.maxTokens,
                    llm_type: 'azure_chat_openai',
                    stream: true,
                },
                store_context: true
            };

            const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.clientId,
                    'x-gw-ims-org-id': this.imsOrgId,
                    'Authorization': `Bearer ${this.accessToken}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                if (response.status === 401) {
                    await this.getAccessToken();
                    return this.generateStream({ model, messages, systemMessage, temperature, maxTokens });
                }
                throw new Error(`Firefall API error: ${response.status} ${response.statusText}`);
            }

            return { stream: this._createStreamIterator(response) };

        } catch (error) {
            logger.error('FirefallAdapter: Streaming generation failed', { error: error.message });
            throw error;
        }
    }

    async *_createStreamIterator(response) {
        const rl = readline.createInterface({
            input: response.body,
            crlfDelay: Infinity
        });

        try {
            for await (const line of rl) {
                const trimmedLine = line.trim();
                if (!trimmedLine.startsWith('data:')) continue;

                const jsonStr = trimmedLine.slice(5).trim();
                if (jsonStr === '[DONE]' || jsonStr === '[DONE]%') break;

                try {
                    const parsed = JSON.parse(jsonStr);
                    const token = parsed.generations?.token || '';
                    if (token) {
                        yield token;
                    }
                } catch (err) {
                    logger.debug('FirefallAdapter: Failed to parse chunk', {
                        error: err.message,
                        chunk: jsonStr
                    });
                }
            }
        } catch (error) {
            logger.error('Error in stream iterator:', { error: error.message });
            throw error;
        } finally {
            rl.close();
        }
    }

    _extractTextFromResponse(responseData) {
        if (responseData?.generations && Array.isArray(responseData.generations)) {
            const generations = responseData.generations.flat();
            if (generations.length > 0 && generations[0].message?.content) {
                return generations[0].message.content.trim();
            }
        }
        throw new Error('Unexpected response structure from Firefall API');
    }
}