// src/adapters/openAiAdapter.js
import OpenAI from 'openai';
import { logger } from '../services/logger.js';

export class OpenAIAdapter {
    constructor(config = {}) {
        this.openai = new OpenAI({
            apiKey: config.apiKey || process.env.OPENAI_API_KEY // API key from config or env variable
        });
        this.provider = 'openai';
        this.model = config.model || "gpt-4o-mini"; // Default model
        this.temperature = config.temperature || 0.9; // Default temperature
        this.maxTokens = config.maxTokens || 1000; // Default max tokens
        this.stream = config.stream || false; // Default stream value
    }

    async generateCode(data) {
        try {
            const response = await this.openai.chat.completions.create({
                model: data.model || this.model, // Prioritize model from data
                messages: [
                    {
                        role: "system",
                        content: data.systemMessage || "You are a helpful assistant!" // System message from data or default
                    },
                    {
                        role: "user",
                        content: data.prompt
                    }
                ],
                max_tokens: data.maxTokens || this.maxTokens, // Prioritize maxTokens from data
                temperature: data.temperature || this.temperature, // Prioritize temperature from data
                stream: data.stream || this.stream // Prioritize stream from data
            });

            return response.choices[0].message.content.trim();
        } catch (error) {
            logger.error('Error generating code with OpenAI:', {
                error: error.message
            });
            throw error;
        }
    }
}