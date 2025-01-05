import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../services/logger.js';

export class AnthropicAdapter {
    constructor(config = {}) {
        this.anthropic = new Anthropic({
            apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
        });
        this.provider = 'anthropic';
        this.model = config.model || "claude-3-5-sonnet-20241022";
        this.temperature = config.temperature || 0.5;
        this.maxTokens = config.maxTokens || 3000;
        this.stream = config.stream || false;
    }

    async generateCode(data) {
        try {
            const response = await this.anthropic.messages.create({
                model: data.model || this.model,
                max_tokens: data.maxTokens || this.maxTokens,
                temperature: data.temperature || this.temperature,
                messages: [
                    {
                        role: "system",
                        content: data.systemMessage || "You are a helpful assistant!"
                    },
                    {
                        role: "user",
                        content: data.prompt
                    }
                ],
                stream: data.stream || this.stream
            });

            return response.content[0].text.trim();
        } catch (error) {
            logger.error('Error generating code with Anthropic:', {
                error: error.message
            });
            throw error;
        }
    }
}
