import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from '../services/logger.js';

export class GoogleAdapter {
    constructor(config = {}) {
        this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
        if (!this.apiKey) {
            logger.error('GoogleAdapter: Missing API key');
            throw new Error('Google API key is required');
        }
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        this.provider = 'google';
        this.modelName = config.model || "gemini-1.5-flash";
        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
        this.temperature = config.temperature || 0.9;
        this.maxTokens = config.maxTokens || 1000;
        this.stream = config.stream || false;
    }

    async generateCode(data) {
        try {
            const prompt = data.prompt;
            const systemMessage = data.systemMessage || "You are a helpful assistant that responds only with the generates code.";

            const generationConfig = {
                temperature: data.temperature || this.temperature,
                maxOutputTokens: data.maxTokens || this.maxTokens,
            };

            const result = await this.model.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: systemMessage },
                            { text: prompt }
                        ]
                    }
                ],
                generationConfig,
            });

            const response = result.response;
            return response.text();

        } catch (error) {
            logger.error('Error generating code with Google:', {
                error: error.message
            });
            throw error;
        }
    }
}