import express from 'express';
import transactionAnalysisService from '../services/transactionAnalysisService.js';
import { logger } from '../services/logger.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Middleware to validate YAML payload
const validateYamlPayload = (req, res, next) => {
    try {
        if (!req.body.yamlContent) {
            return res.status(400).json({
                success: false,
                error: 'YAML content is required'
            });
        }

        if (typeof req.body.yamlContent !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'YAML content must be a string'
            });
        }

        // Basic validation - should contain some trace-like content
        if (!req.body.yamlContent.includes('#') || req.body.yamlContent.length < 50) {
            return res.status(400).json({
                success: false,
                error: 'Invalid YAML content format'
            });
        }

        next();
    } catch (error) {
        logger.error('Error validating YAML payload:', error);
        return res.status(400).json({
            success: false,
            error: 'Invalid YAML format'
        });
    }
};

// Analyze a single transaction
router.post('/analyze', requireAuth, validateYamlPayload, async (req, res) => {
    const requestStartTime = Date.now();
    
    try {
        const { yamlContent, tokenCount, analysisName, extraContext, projectId } = req.body;
        const userId = req.session.user.id;
        
        // Validate project ID is provided
        if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Project ID is required'
            });
        }
        
        // Environment is not required for transaction analysis
        const environment = 'production'; // Default environment for analytics

        logger.info(`[API] Transaction analysis request from user ${userId} for ${projectId}/${environment}, analysisName: "${analysisName}"`);
        logger.info(`[API] YAML content size: ${yamlContent.length} characters, estimated tokens: ${tokenCount || 'unknown'}`);
        if (extraContext) {
            logger.info(`[API] Extra context provided: ${extraContext.length} characters`);
        }

        // Step 1: Create the analysis record immediately (synchronous)
        const createStartTime = Date.now();
        const analysisData = {
            projectId,
            environment,
            userId,
            analysisName: analysisName || `Transaction Analysis ${new Date().toLocaleString()}`,
            originalPayload: '', // Not storing the original JSON anymore
            yamlContent: yamlContent,
            analysisResult: '',
            status: 'processing',
            tokenCount: tokenCount || 0,
            extraContext: extraContext || null
        };

        const dbResult = await transactionAnalysisService.dao.createAnalysis(analysisData);
        const analysisId = dbResult.id;
        const createTime = Date.now() - createStartTime;
        
        logger.info(`[API] Analysis record created with ID ${analysisId} in ${createTime}ms`);

        // Step 2: Return immediately with the analysis ID
        const totalRequestTime = Date.now() - requestStartTime;
        logger.info(`[API] Returning analysis ID ${analysisId} after ${totalRequestTime}ms - processing will continue in background`);
        
        res.json({
            success: true,
            analysisId: analysisId,
            analysisName: analysisData.analysisName,
            message: 'Analysis started successfully'
        });

        // Step 3: Process the analysis in the background (asynchronous)
        setImmediate(async () => {
            try {
                logger.info(`[BACKGROUND] Starting background processing for analysis ${analysisId}`);
                const backgroundStartTime = Date.now();
                
                const result = await transactionAnalysisService.analyzeTransactionFromYaml(
                    yamlContent,
                    extraContext,
                    userId,
                    projectId,
                    environment,
                    analysisName,
                    analysisId // Pass the existing analysis ID
                );

                const backgroundTime = Date.now() - backgroundStartTime;
                logger.info(`[BACKGROUND] Analysis ${analysisId} completed in ${backgroundTime}ms`);

                if (!result.success) {
                    logger.error(`[BACKGROUND] Analysis ${analysisId} failed: ${result.error}`);
                }
            } catch (error) {
                const backgroundTime = Date.now() - requestStartTime;
                logger.error(`[BACKGROUND] Background processing failed for analysis ${analysisId} after ${backgroundTime}ms:`, error);
                
                // Update the analysis status to failed
                try {
                    await transactionAnalysisService.dao.updateAnalysisStatus(
                        analysisId,
                        'failed',
                        null,
                        error.message,
                        0
                    );
                } catch (updateError) {
                    logger.error(`[BACKGROUND] Failed to update analysis ${analysisId} status to failed:`, updateError);
                }
            }
        });

    } catch (error) {
        const totalRequestTime = Date.now() - requestStartTime;
        logger.error(`[API] Error in transaction analysis endpoint after ${totalRequestTime}ms:`, error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get analysis by ID
router.get('/analysis/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { projectId } = req.query;
        
        // Validate project ID is provided
        if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Project ID is required'
            });
        }

        const result = await transactionAnalysisService.getAnalysisById(id);

        if (result.success) {
            // Check if the analysis belongs to the current project
            if (result.analysis.project_id !== projectId) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied to this analysis'
                });
            }

            res.json({
                success: true,
                analysis: result.analysis
            });
        } else {
            res.status(404).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        logger.error('Error getting analysis by ID:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get analyses by project
router.get('/analyses', requireAuth, async (req, res) => {
    try {
        // For now, use default project/environment - this can be enhanced later
        const projectId = 'default-project';
        const environment = 'production';
        const { limit = 50, offset = 0 } = req.query;

        const result = await transactionAnalysisService.getAnalysesByProject(
            projectId,
            environment,
            parseInt(limit),
            parseInt(offset)
        );

        if (result.success) {
            res.json({
                success: true,
                analyses: result.analyses
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        logger.error('Error getting analyses by project:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Delete analysis
router.delete('/analysis/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { projectId } = req.query;
        
        // Validate project ID is provided
        if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Project ID is required'
            });
        }

        // First check if the analysis exists and belongs to the current project
        const analysisResult = await transactionAnalysisService.getAnalysisById(id);
        
        if (!analysisResult.success) {
            return res.status(404).json({
                success: false,
                error: 'Analysis not found'
            });
        }

        if (analysisResult.analysis.project_id !== projectId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this analysis'
            });
        }

        const result = await transactionAnalysisService.deleteAnalysis(id);

        if (result.success) {
            res.json({
                success: true,
                message: 'Analysis deleted successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        logger.error('Error deleting analysis:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});


// Search analyses
router.get('/search', requireAuth, async (req, res) => {
    try {
        const { projectId, q: searchTerm, limit = 20 } = req.query;
        
        // Validate project ID is provided
        if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Project ID is required'
            });
        }
        
        const environment = 'production'; // Default environment for analytics

        if (!searchTerm) {
            return res.status(400).json({
                success: false,
                error: 'Search term is required'
            });
        }

        const result = await transactionAnalysisService.searchAnalyses(
            projectId,
            environment,
            searchTerm,
            parseInt(limit)
        );

        if (result.success) {
            res.json({
                success: true,
                analyses: result.analyses
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        logger.error('Error searching analyses:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get recent analyses for a specific project
router.get('/recent', requireAuth, async (req, res) => {
    try {
        const { projectId, limit = 10 } = req.query;
        
        // Validate project ID is provided
        if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Project ID is required'
            });
        }

        const result = await transactionAnalysisService.getRecentAnalysesByProject(projectId, parseInt(limit));

        if (result.success) {
            res.json({
                success: true,
                analyses: result.analyses
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error
            });
        }

    } catch (error) {
        logger.error('Error getting recent analyses:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

export default router; 