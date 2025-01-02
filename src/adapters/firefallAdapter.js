import { logger } from '../services/logger.js';
import fetch from 'node-fetch';

export class FirefallAdapter {
    constructor() {
        this.baseUrl = process.env.FIREFALL_URL || 'https://firefall-stage.adobe.io';
        this.imsEndpoint = process.env.FIREFALL_IMS_ENDPOINT || 'https://ims-na1-stg1.adobelogin.com/ims/token/v4';
        this.clientId = process.env.FIREFALL_CLIENT_ID;
        this.clientSecret = process.env.FIREFALL_CLIENT_SECRET;
        this.imsOrgId = process.env.FIREFALL_IMS_ORG_ID;
        this.authCode = process.env.FIREFALL_AUTH_CODE;

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

    async generateCode(prompt) {
        try {
            await this.initialize();

            const requestBody = {
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that generates code.",
                    },
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
                llm_metadata: {
                    model_name: "gpt-4o",
                    temperature: 0.5,
                    max_tokens: 3000,
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
                    return this.generateCode(prompt);
                }
                throw new Error(`Firefall API error: ${response.status} ${response.statusText}, Error: ${errorText}`);
            }

            const responseData = await response.json();

            logger.debug('FirefallAdapter: Response data', { responseData });

            // Return the raw response content
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