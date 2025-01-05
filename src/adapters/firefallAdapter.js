import { logger } from '../services/logger.js';
import fetch from 'node-fetch';

export class FirefallAdapter {
    constructor(config = {}) {
        this.provider = 'firefall';
        this.baseUrl = config.baseUrl || process.env.FIREFALL_URL || 'https://firefall-stage.adobe.io';
        this.imsEndpoint = config.imsEndpoint || process.env.FIREFALL_IMS_ENDPOINT || 'https://ims-na1-stg1.adobelogin.com/ims/token/v4';
        this.clientId = config.clientId || process.env.FIREFALL_CLIENT_ID;
        this.clientSecret = config.clientSecret || process.env.FIREFALL_CLIENT_SECRET;
        this.imsOrgId = config.imsOrgId || process.env.FIREFALL_IMS_ORG_ID;
        this.authCode = config.authCode || process.env.FIREFALL_AUTH_CODE;
        this.model = config.model || "gpt-4o-mini";
        this.temperature = config.temperature || 0.9;
        this.maxTokens = config.maxTokens || 1000;
        this.stream = config.stream || false;

        if (!this.clientId || !this.clientSecret || !this.imsOrgId || !this.authCode) {
            logger.error('FirefallAdapter: Missing required configuration');
            throw new Error('Missing required Firefall configuration');
        }

        this.accessToken = null;
        this.tokenExpiresAt = null;
    }

    async initialize() {
        if (!this.accessToken || this.isTokenExpired()) {
            await this.getAccessToken();
        }
    }

    isTokenExpired() {
        return this.tokenExpiresAt ? Date.now() >= this.tokenExpiresAt : true;
    }

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
            this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

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
                        role: "system",
                        content: data.systemMessage || "You are a helpful assistant that generates code.",
                    },
                    {
                        role: "user",
                        content: data.prompt,
                    },
                ],
                llm_metadata: {
                    model_name: data.model || this.model,
                    temperature: data.temperature || this.temperature,
                    max_tokens: data.maxTokens || this.maxTokens,
                    llm_type: "azure_chat_openai"
                },
            };

            const response = await fetch(`${this.baseUrl}/v2/chat/completions`, {
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
                const errorText = await response.text();
                if (response.status === 401) {
                    logger.info('FirefallAdapter: Unauthorized, attempting token refresh');
                    await this.getAccessToken();
                    return this.generateCode(data); // Retry with new token
                }
                throw new Error(`Firefall API error: ${response.status} ${response.statusText}, Error: ${errorText}`);
            }

            const responseData = await response.json();

            // Return the generated code
            if (responseData.choices && responseData.choices[0] && responseData.choices[0].message && responseData.choices[0].message.content) {
                const generatedCode = responseData.choices[0].message.content;
                logger.info('FirefallAdapter: Successfully generated code', { codeLength: generatedCode.length });
                return generatedCode;
            } else {
                logger.error('FirefallAdapter: Unexpected response structure', { responseData });
                throw new Error('Unexpected response structure from Firefall API');
            }

        } catch (error) {
            logger.error('FirefallAdapter: Code generation failed', { error: error.message });
            throw error;
        }
    }
}
