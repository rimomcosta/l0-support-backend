// src/adapters/anthropicAdapter.js
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../services/logger.js';

export class AnthropicAdapter {
    constructor() {
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
    }

    async generateCode(prompt) {
        try {
            const response = await this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 3000,
                temperature: 0.5,
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            });

            // Extract and return the generated code
            return response.content[0].text.trim();
        } catch (error) {
            logger.error('Error generating code with Anthropic:', {
                error: error.message
            });
            throw error;
        }
    }
}