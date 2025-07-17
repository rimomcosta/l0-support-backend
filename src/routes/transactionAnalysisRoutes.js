import express from 'express';
import transactionAnalysisService from '../services/transactionAnalysisService.js';
import { logger } from '../services/logger.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Middleware to validate JSON payload
const validateJsonPayload = (req, res, next) => {
    try {
        if (!req.body.payload) {
            return res.status(400).json({
                success: false,
                error: 'Payload is required'
            });
        }

        // If payload is a string, try to parse it
        if (typeof req.body.payload === 'string') {
            req.body.payload = JSON.parse(req.body.payload);
        }

        // Validate that it's a New Relic trace format
        if (!req.body.payload.data?.actor?.entity?.transactionTrace) {
            return res.status(400).json({
                success: false,
                error: 'Invalid New Relic trace format. Payload must contain data.actor.entity.transactionTrace'
            });
        }

        next();
    } catch (error) {
        logger.error('Error validating JSON payload:', error);
        return res.status(400).json({
            success: false,
            error: 'Invalid JSON format'
        });
    }
};

// Analyze a single transaction
router.post('/analyze', requireAuth, validateJsonPayload, async (req, res) => {
    const requestStartTime = Date.now();
    
    try {
        const { payload, analysisName } = req.body;
        const userId = req.session.user.id;
        // For now, use default project/environment - this can be enhanced later
        const projectId = 'default-project';
        const environment = 'production';

        logger.info(`[API] Transaction analysis request from user ${userId} for ${projectId}/${environment}, analysisName: "${analysisName}"`);
        logger.info(`[API] Payload size: ${JSON.stringify(payload).length} characters`);

        // Step 1: Create the analysis record immediately (synchronous)
        const createStartTime = Date.now();
        const analysisData = {
            projectId,
            environment,
            userId,
            analysisName: analysisName || `Transaction Analysis ${new Date().toLocaleString()}`,
            originalPayload: JSON.stringify(payload),
            yamlContent: '', // Will be populated in background
            analysisResult: '',
            status: 'processing',
            tokenCount: 0
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
                
                const result = await transactionAnalysisService.analyzeTransaction(
                    payload,
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
        // For now, use default project/environment - this can be enhanced later
        const projectId = 'default-project';
        const environment = 'production';

        const result = await transactionAnalysisService.getAnalysisById(id);

        if (result.success) {
            // Check if the analysis belongs to the current project/environment
            if (result.analysis.project_id !== projectId || result.analysis.environment !== environment) {
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
        // For now, use default project/environment - this can be enhanced later
        const projectId = 'default-project';
        const environment = 'production';

        // First check if the analysis exists and belongs to the current project
        const analysisResult = await transactionAnalysisService.getAnalysisById(id);
        
        if (!analysisResult.success) {
            return res.status(404).json({
                success: false,
                error: 'Analysis not found'
            });
        }

        if (analysisResult.analysis.project_id !== projectId || analysisResult.analysis.environment !== environment) {
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

// Get analysis statistics
router.get('/stats', requireAuth, async (req, res) => {
    try {
        // For now, use default project/environment - this can be enhanced later
        const projectId = 'default-project';
        const environment = 'production';
        
        const result = await transactionAnalysisService.getAnalysisStats(projectId, environment);
        
        if (result.success) {
            res.json({
                success: true,
                stats: result.stats
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error
            });
        }
    } catch (error) {
        logger.error('Error in analysis stats endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Search analyses
router.get('/search', requireAuth, async (req, res) => {
    try {
        // For now, use default project/environment - this can be enhanced later
        const projectId = 'default-project';
        const environment = 'production';
        const { q: searchTerm, limit = 20 } = req.query;

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

// Get recent analyses (across all projects)
router.get('/recent', requireAuth, async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const result = await transactionAnalysisService.getRecentAnalyses(parseInt(limit));

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