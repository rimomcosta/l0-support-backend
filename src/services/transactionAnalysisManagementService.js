// src/services/transactionAnalysisManagementService.js
import transactionAnalysisService from './transactionAnalysisService.js';
import { logger } from './logger.js';

export class TransactionAnalysisManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate YAML payload
     * @param {Object} payload - The request payload
     * @returns {Object} - Validation result
     */
    validateYamlPayload(payload) {
        try {
            if (!payload.yamlContent) {
                return {
                    valid: false,
                    error: 'YAML content is required'
                };
            }

            if (typeof payload.yamlContent !== 'string') {
                return {
                    valid: false,
                    error: 'YAML content must be a string'
                };
            }

            // Basic validation - should contain some trace-like content
            if (!payload.yamlContent.includes('#') || payload.yamlContent.length < 50) {
                return {
                    valid: false,
                    error: 'Invalid YAML content format'
                };
            }

            return { valid: true };
        } catch (error) {
            this.logger.error('Error validating YAML payload:', error);
            return {
                valid: false,
                error: 'Invalid YAML format'
            };
        }
    }

    /**
     * Validate project ID
     * @param {string} projectId - Project ID to validate
     * @returns {Object} - Validation result
     */
    validateProjectId(projectId) {
        if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
            return {
                valid: false,
                error: 'Project ID is required'
            };
        }
        return { valid: true };
    }

    /**
     * Analyze a transaction with background processing
     * @param {Object} analysisData - Analysis data
     * @param {string} userId - User ID
     * @returns {Object} - Analysis result
     */
    async analyzeTransaction(analysisData, userId) {
        const requestStartTime = Date.now();
        
        try {
            const { yamlContent, tokenCount, analysisName, extraContext, projectId } = analysisData;
            
            // Validate project ID
            const projectValidation = this.validateProjectId(projectId);
            if (!projectValidation.valid) {
                return {
                    success: false,
                    error: projectValidation.error,
                    statusCode: 400
                };
            }
            
            // Environment is not required for transaction analysis
            const environment = 'production'; // Default environment for analytics

            this.logger.info(`[API] Transaction analysis request from user ${userId} for ${projectId}/${environment}, analysisName: "${analysisName}"`);
            this.logger.info(`[API] YAML content size: ${yamlContent.length} characters, estimated tokens: ${tokenCount || 'unknown'}`);
            if (extraContext) {
                this.logger.info(`[API] Extra context provided: ${extraContext.length} characters`);
            }

            // Step 1: Create the analysis record immediately (synchronous)
            const createStartTime = Date.now();
            const analysisRecord = {
                projectId,
                environment,
                userId,
                analysisName: analysisName || `Transaction Analysis ${new Date().toLocaleString()}`,
                originalPayload: '', // Not storing the original JSON anymore
                analysisResult: '',
                status: 'processing',
                tokenCount: tokenCount || 0,
                extraContext: extraContext || null
            };

            const dbResult = await transactionAnalysisService.dao.createAnalysis(analysisRecord);
            const analysisId = dbResult.id;
            const createTime = Date.now() - createStartTime;
            
            this.logger.info(`[API] Analysis record created with ID ${analysisId} in ${createTime}ms`);

            // Step 2: Return immediately with the analysis ID
            const totalRequestTime = Date.now() - requestStartTime;
            this.logger.info(`[API] Returning analysis ID ${analysisId} after ${totalRequestTime}ms - processing will continue in background`);
            
            // Step 3: Process the analysis in the background (asynchronous)
            setImmediate(async () => {
                try {
                    this.logger.info(`[BACKGROUND] Starting background processing for analysis ${analysisId}`);
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
                    this.logger.info(`[BACKGROUND] Analysis ${analysisId} completed in ${backgroundTime}ms`);

                    if (!result.success) {
                        this.logger.error(`[BACKGROUND] Analysis ${analysisId} failed: ${result.error}`);
                    }
                } catch (error) {
                    const backgroundTime = Date.now() - requestStartTime;
                    this.logger.error(`[BACKGROUND] Background processing failed for analysis ${analysisId} after ${backgroundTime}ms:`, error);
                    
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
                        this.logger.error(`[BACKGROUND] Failed to update analysis ${analysisId} status to failed:`, updateError);
                    }
                }
            });

            return {
                success: true,
                analysisId: analysisId,
                analysisName: analysisRecord.analysisName,
                message: 'Analysis started successfully'
            };

        } catch (error) {
            const totalRequestTime = Date.now() - requestStartTime;
            this.logger.error(`[API] Error in transaction analysis endpoint after ${totalRequestTime}ms:`, error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Get analysis by ID with access control
     * @param {string} id - Analysis ID
     * @param {string} projectId - Project ID for access control
     * @returns {Object} - Analysis result
     */
    async getAnalysisById(id, projectId) {
        try {
            // Validate project ID
            const projectValidation = this.validateProjectId(projectId);
            if (!projectValidation.valid) {
                return {
                    success: false,
                    error: projectValidation.error,
                    statusCode: 400
                };
            }

            const result = await transactionAnalysisService.getAnalysisById(id);

            if (result.success) {
                // Check if the analysis belongs to the current project
                if (result.analysis.project_id !== projectId) {
                    return {
                        success: false,
                        error: 'Access denied to this analysis',
                        statusCode: 403
                    };
                }

                return {
                    success: true,
                    analysis: result.analysis
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    statusCode: 404
                };
            }

        } catch (error) {
            this.logger.error('Error getting analysis by ID:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Get analyses by project
     * @param {string} projectId - Project ID
     * @param {number} limit - Limit
     * @param {number} offset - Offset
     * @returns {Object} - Analyses result
     */
    async getAnalysesByProject(projectId, limit = 50, offset = 0) {
        try {
            // For now, use default project/environment - this can be enhanced later
            const defaultProjectId = 'default-project';
            const environment = 'production';

            const result = await transactionAnalysisService.getAnalysesByProject(
                defaultProjectId,
                environment,
                parseInt(limit),
                parseInt(offset)
            );

            if (result.success) {
                return {
                    success: true,
                    analyses: result.analyses
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    statusCode: 500
                };
            }

        } catch (error) {
            this.logger.error('Error getting analyses by project:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Delete analysis with access control
     * @param {string} id - Analysis ID
     * @param {string} projectId - Project ID for access control
     * @returns {Object} - Delete result
     */
    async deleteAnalysis(id, projectId) {
        try {
            // Validate project ID
            const projectValidation = this.validateProjectId(projectId);
            if (!projectValidation.valid) {
                return {
                    success: false,
                    error: projectValidation.error,
                    statusCode: 400
                };
            }

            // First check if the analysis exists and belongs to the current project
            const analysisResult = await transactionAnalysisService.getAnalysisById(id);
            
            if (!analysisResult.success) {
                return {
                    success: false,
                    error: 'Analysis not found',
                    statusCode: 404
                };
            }

            if (analysisResult.analysis.project_id !== projectId) {
                return {
                    success: false,
                    error: 'Access denied to this analysis',
                    statusCode: 403
                };
            }

            const result = await transactionAnalysisService.deleteAnalysis(id);

            if (result.success) {
                return {
                    success: true,
                    message: 'Analysis deleted successfully'
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    statusCode: 500
                };
            }

        } catch (error) {
            this.logger.error('Error deleting analysis:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Search analyses
     * @param {string} projectId - Project ID
     * @param {string} searchTerm - Search term
     * @param {number} limit - Limit
     * @returns {Object} - Search result
     */
    async searchAnalyses(projectId, searchTerm, limit = 20) {
        try {
            // Validate project ID
            const projectValidation = this.validateProjectId(projectId);
            if (!projectValidation.valid) {
                return {
                    success: false,
                    error: projectValidation.error,
                    statusCode: 400
                };
            }
            
            const environment = 'production'; // Default environment for analytics

            if (!searchTerm) {
                return {
                    success: false,
                    error: 'Search term is required',
                    statusCode: 400
                };
            }

            const result = await transactionAnalysisService.searchAnalyses(
                projectId,
                environment,
                searchTerm,
                parseInt(limit)
            );

            if (result.success) {
                return {
                    success: true,
                    analyses: result.analyses
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    statusCode: 500
                };
            }

        } catch (error) {
            this.logger.error('Error searching analyses:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Get recent analyses for a specific project
     * @param {string} projectId - Project ID
     * @param {number} limit - Limit
     * @returns {Object} - Recent analyses result
     */
    async getRecentAnalyses(projectId, limit = 10) {
        try {
            // Validate project ID
            const projectValidation = this.validateProjectId(projectId);
            if (!projectValidation.valid) {
                return {
                    success: false,
                    error: projectValidation.error,
                    statusCode: 400
                };
            }

            const result = await transactionAnalysisService.getRecentAnalysesByProject(projectId, parseInt(limit));

            if (result.success) {
                return {
                    success: true,
                    analyses: result.analyses
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    statusCode: 500
                };
            }

        } catch (error) {
            this.logger.error('Error getting recent analyses:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Update analysis use_ai status with access control
     * @param {string} id - Analysis ID
     * @param {boolean} useAi - Use AI flag
     * @param {string} projectId - Project ID for access control
     * @returns {Object} - Update result
     */
    async updateAnalysisUseAi(id, useAi, projectId) {
        try {
            // Validate project ID
            const projectValidation = this.validateProjectId(projectId);
            if (!projectValidation.valid) {
                return {
                    success: false,
                    error: projectValidation.error,
                    statusCode: 400
                };
            }

            // Validate useAi is boolean
            if (typeof useAi !== 'boolean') {
                return {
                    success: false,
                    error: 'useAi must be a boolean value',
                    statusCode: 400
                };
            }

            // First check if the analysis exists and belongs to the current project
            const analysisResult = await transactionAnalysisService.getAnalysisById(id);
            
            if (!analysisResult.success) {
                return {
                    success: false,
                    error: 'Analysis not found',
                    statusCode: 404
                };
            }

            if (analysisResult.analysis.project_id !== projectId) {
                return {
                    success: false,
                    error: 'Access denied to this analysis',
                    statusCode: 403
                };
            }

            const result = await transactionAnalysisService.updateAnalysisUseAi(id, useAi);

            if (result.success) {
                return {
                    success: true,
                    message: result.message
                };
            } else {
                return {
                    success: false,
                    error: result.error,
                    statusCode: 500
                };
            }

        } catch (error) {
            this.logger.error('Error updating analysis use_ai:', error);
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }
}
