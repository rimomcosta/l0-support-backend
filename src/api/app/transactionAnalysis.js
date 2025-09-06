// src/api/app/transactionAnalysis.js
import { TransactionAnalysisManagementService } from '../../services/transactionAnalysisManagementService.js';
import { logger } from '../../services/logger.js';

// Middleware to validate YAML payload
const validateYamlPayload = (req, res, next) => {
    const managementService = new TransactionAnalysisManagementService();
    const validation = managementService.validateYamlPayload(req.body);
    
    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            error: validation.error
        });
    }
    
    next();
};

// Analyze a single transaction
export async function analyzeTransaction(req, res) {
    try {
        const { yamlContent, tokenCount, analysisName, extraContext, projectId } = req.body;
        const userId = req.session.user.id;
        
        // Delegate to service
        const managementService = new TransactionAnalysisManagementService();
        const result = await managementService.analyzeTransaction(
            { yamlContent, tokenCount, analysisName, extraContext, projectId },
            userId
        );

        res.status(result.statusCode || 200).json(result);

    } catch (error) {
        logger.error('Error in transaction analysis endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Get analysis by ID
export async function getAnalysisById(req, res) {
    try {
        const { id } = req.params;
        const { projectId } = req.query;
        
        // Delegate to service
        const managementService = new TransactionAnalysisManagementService();
        const result = await managementService.getAnalysisById(id, projectId);

        res.status(result.statusCode || 200).json(result);

    } catch (error) {
        logger.error('Error getting analysis by ID:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Get analyses by project
export async function getAnalysesByProject(req, res) {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const projectId = 'default-project'; // For now, use default project

        // Delegate to service
        const managementService = new TransactionAnalysisManagementService();
        const result = await managementService.getAnalysesByProject(projectId, parseInt(limit), parseInt(offset));

        res.status(result.statusCode || 200).json(result);

    } catch (error) {
        logger.error('Error getting analyses by project:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Delete analysis
export async function deleteAnalysis(req, res) {
    try {
        const { id } = req.params;
        const { projectId } = req.query;
        
        // Delegate to service
        const managementService = new TransactionAnalysisManagementService();
        const result = await managementService.deleteAnalysis(id, projectId);

        res.status(result.statusCode || 200).json(result);

    } catch (error) {
        logger.error('Error deleting analysis:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Search analyses
export async function searchAnalyses(req, res) {
    try {
        const { projectId, q: searchTerm, limit = 20 } = req.query;
        
        // Delegate to service
        const managementService = new TransactionAnalysisManagementService();
        const result = await managementService.searchAnalyses(projectId, searchTerm, parseInt(limit));

        res.status(result.statusCode || 200).json(result);

    } catch (error) {
        logger.error('Error searching analyses:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Get recent analyses for a specific project
export async function getRecentAnalyses(req, res) {
    try {
        const { projectId, limit = 10 } = req.query;
        
        // Delegate to service
        const managementService = new TransactionAnalysisManagementService();
        const result = await managementService.getRecentAnalyses(projectId, parseInt(limit));

        res.status(result.statusCode || 200).json(result);

    } catch (error) {
        logger.error('Error getting recent analyses:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Update analysis use_ai status
export async function updateAnalysisUseAi(req, res) {
    try {
        const { id } = req.params;
        const { useAi, projectId } = req.body;
        
        // Delegate to service
        const managementService = new TransactionAnalysisManagementService();
        const result = await managementService.updateAnalysisUseAi(id, useAi, projectId);

        res.status(result.statusCode || 200).json(result);

    } catch (error) {
        logger.error('Error updating analysis use_ai:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// Export validation middleware for use in routes
export { validateYamlPayload };