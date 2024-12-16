// src/adapters/openAiAdapter.js
import OpenAI from 'openai';
import { logger } from '../services/logger.js';

export class OpenAIAdapter {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    async generateCode(prompt) {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o", // Or another suitable model
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 3000, // Adjust as needed
                temperature: 0.9, // Adjust for creativity vs. precision
            });

            // Extract and return the generated code
            return response.choices[0].message.content.trim();
        } catch (error) {
            logger.error('Error generating code with OpenAI:', {
                error: error.message
            });
            throw error;
        }
    }
}