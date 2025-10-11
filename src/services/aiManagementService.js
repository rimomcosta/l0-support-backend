// src/services/aiManagementService.js
import ReactComponentCreator from './ai/agents/reactComponentCreator.js';
import { logger } from './logger.js';

export class AiManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate AI component generation input
     * @param {Object} inputData - Input data to validate
     * @returns {Object} - Validation result
     */
    validateComponentInput(inputData) {
        const { command, description, outputExample, aiGuidance } = inputData;

        if (!outputExample || !command) {
            return {
                valid: false,
                error: 'Command, description and output example are required'
            };
        }

        return { valid: true };
    }

    /**
     * Generate component code using AI
     * @param {Object} inputData - Input data for component generation
     * @param {string} userId - User ID for quota tracking
     * @returns {Object} - Result with generated code or error
     */
    async generateComponentCode(inputData, userId = null) {
        try {
            const { command, description, outputExample, aiGuidance } = inputData;

            const validation = this.validateComponentInput(inputData);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error,
                    statusCode: 400
                };
            }

            const data = {
                command,
                description,
                outputExample,
                aiGuidance,
            };

            const generatedCode = await ReactComponentCreator.generateComponent(data, userId);
            
            return {
                success: true,
                generatedCode,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('AI code generation failed:', error);
            
            // Check if it's a quota exceeded error
            const isQuotaError = error.message && error.message.includes('quota');
            
            return {
                success: false,
                error: isQuotaError ? error.message : 'Failed to generate component code',
                quotaExceeded: isQuotaError,
                statusCode: isQuotaError ? 429 : 500
            };
        }
    }
}
