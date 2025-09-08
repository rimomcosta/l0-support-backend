// src/api/app/ai.js
import { AiManagementService } from '../../services/aiManagementService.js';
import { logger } from '../../services/logger.js';

export async function generateComponentCode(req, res) {
    try {
        const { command, description, outputExample, aiGuidance } = req.body;

        const aiService = new AiManagementService();
        const result = await aiService.generateComponentCode({
            command, description, outputExample, aiGuidance
        });
        
        res.status(result.statusCode).json(result.success ? {
            generatedCode: result.generatedCode
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error('AI code generation failed:', error);
        res.status(500).json({ error: 'Failed to generate component code' });
    }
}