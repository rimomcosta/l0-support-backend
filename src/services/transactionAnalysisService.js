import { logger } from './logger.js';
import yamlConversionService from './yamlConversionService.js';
import transactionAnalysisAgent from './ai/agents/transactionAnalysis.js';
import transactionAnalysisDao from './dao/transactionAnalysisDao.js';
import { WebSocketService } from './webSocketService.js';

class TransactionAnalysisService {
    constructor() {
        this.logger = logger;
        this.yamlService = yamlConversionService;
        this.aiAgent = transactionAnalysisAgent;
        this.dao = transactionAnalysisDao;
    }

    async analyzeTransaction(payload, userId, projectId, environment, analysisName, existingAnalysisId = null) {
        const startTime = Date.now();
        
        try {
            this.logger.info(`[ANALYSIS START] User ${userId} starting analysis "${analysisName}" in ${projectId}/${environment}`);
            
            // Step 1: Convert JSON to YAML
            this.logger.info(`[YAML CONVERSION] Starting YAML conversion for "${analysisName}"`);
            const yamlStartTime = Date.now();
            const yamlResult = await this.yamlService.convertPayload(payload);
            const yamlTime = Date.now() - yamlStartTime;
            
            if (!yamlResult.success) {
                this.logger.error(`[YAML CONVERSION FAILED] ${analysisName}: ${yamlResult.error}`);
                throw new Error(`YAML conversion failed: ${yamlResult.error}`);
            }
            
            this.logger.info(`[YAML CONVERSION COMPLETE] ${analysisName} converted in ${yamlTime}ms, ${yamlResult.tokenCount} tokens`);

            // Step 2: Update the existing database record with YAML content
            this.logger.info(`[DB UPDATE] Updating analysis record with YAML content for "${analysisName}"`);
            const dbStartTime = Date.now();
            
            let analysisId;
            if (existingAnalysisId) {
                // Update existing record with YAML content
                analysisId = existingAnalysisId;
                await this.dao.updateAnalysisYaml(analysisId, yamlResult.yamlContent, yamlResult.tokenCount);
            } else {
                // Create new record (fallback for direct service calls)
                const analysisData = {
                    projectId,
                    environment,
                    userId,
                    analysisName: analysisName || `Transaction Analysis ${new Date().toISOString()}`,
                    originalPayload: JSON.stringify(payload),
                    yamlContent: yamlResult.yamlContent,
                    analysisResult: '',
                    status: 'processing',
                    tokenCount: yamlResult.tokenCount
                };

                const dbResult = await this.dao.createAnalysis(analysisData);
                analysisId = dbResult.id;
            }
            
            const dbTime = Date.now() - dbStartTime;
            this.logger.info(`[DB UPDATE COMPLETE] ${analysisName} (ID: ${analysisId}) updated in ${dbTime}ms`);

            // Step 3: Perform AI analysis
            this.logger.info(`[AI ANALYSIS START] Starting AI analysis for "${analysisName}" (ID: ${analysisId})`);
            const aiStartTime = Date.now();
            const aiResult = await this.aiAgent.analyzeTransaction(
                yamlResult.yamlContent,
                analysisName,
                projectId,
                environment
            );
            const aiTime = Date.now() - aiStartTime;
            this.logger.info(`[AI ANALYSIS COMPLETE] ${analysisName} (ID: ${analysisId}) completed in ${aiTime}ms`);

            const totalProcessingTime = Date.now() - startTime;

            // Step 4: Update database with results
            this.logger.info(`[DB UPDATE] Updating analysis results for "${analysisName}" (ID: ${analysisId})`);
            const updateStartTime = Date.now();
            
            if (aiResult.success) {
                await this.dao.updateAnalysisStatus(
                    analysisId,
                    'completed',
                    aiResult.analysis,
                    null,
                    aiResult.processingTimeMs
                );

                // Broadcast the update
                WebSocketService.broadcastAnalysisUpdate(analysisId, 'completed');

                const updateTime = Date.now() - updateStartTime;
                this.logger.info(`[ANALYSIS SUCCESS] ${analysisName} (ID: ${analysisId}) completed successfully in ${totalProcessingTime}ms total (AI: ${aiTime}ms, DB: ${updateTime}ms)`);
                
                return {
                    success: true,
                    analysisId,
                    analysisName: analysisName,
                    analysis: aiResult.analysis,
                    processingTimeMs: aiResult.processingTimeMs,
                    tokenCount: aiResult.tokenCount,
                    totalProcessingTimeMs: totalProcessingTime
                };
            } else {
                await this.dao.updateAnalysisStatus(
                    analysisId,
                    'failed',
                    null,
                    aiResult.error,
                    aiResult.processingTimeMs
                );

                // Broadcast the update
                WebSocketService.broadcastAnalysisUpdate(analysisId, 'failed');

                const updateTime = Date.now() - updateStartTime;
                this.logger.error(`[ANALYSIS FAILED] ${analysisName} (ID: ${analysisId}) failed after ${totalProcessingTime}ms: ${aiResult.error}`);

                throw new Error(`AI analysis failed: ${aiResult.error}`);
            }

        } catch (error) {
            const totalProcessingTime = Date.now() - startTime;
            this.logger.error(`[ANALYSIS ERROR] ${analysisName} failed after ${totalProcessingTime}ms:`, error);
            
            // If an analysisId was created, mark it as failed
            if (existingAnalysisId) {
                await this.dao.updateAnalysisStatus(existingAnalysisId, 'failed', null, error.message, 0);
                WebSocketService.broadcastAnalysisUpdate(existingAnalysisId, 'failed');
            }

            return {
                success: false,
                error: error.message,
                totalProcessingTimeMs: totalProcessingTime
            };
        }
    }

    async getAnalysisById(analysisId) {
        try {
            const analysis = await this.dao.getAnalysisById(analysisId);
            
            if (!analysis) {
                throw new Error(`Analysis with ID ${analysisId} not found`);
            }

            return {
                success: true,
                analysis
            };

        } catch (error) {
            this.logger.error('Error getting analysis by ID:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getAnalysesByProject(projectId, environment, limit = 50, offset = 0) {
        try {
            const analyses = await this.dao.getAnalysesByProject(projectId, environment, limit, offset);
            
            return {
                success: true,
                analyses
            };

        } catch (error) {
            this.logger.error('Error getting analyses by project:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async deleteAnalysis(analysisId) {
        try {
            await this.dao.deleteAnalysis(analysisId);
            
            return {
                success: true
            };

        } catch (error) {
            this.logger.error('Error deleting analysis:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getAnalysisStats(projectId, environment) {
        try {
            const stats = await this.dao.getAnalysisStats(projectId, environment);
            
            return {
                success: true,
                stats
            };

        } catch (error) {
            this.logger.error('Error getting analysis stats:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async searchAnalyses(projectId, environment, searchTerm, limit = 20) {
        try {
            const analyses = await this.dao.searchAnalyses(projectId, environment, searchTerm, limit);
            
            return {
                success: true,
                analyses
            };

        } catch (error) {
            this.logger.error('Error searching analyses:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getRecentAnalyses(limit = 10) {
        try {
            const analyses = await this.dao.getRecentAnalyses(limit);
            
            return {
                success: true,
                analyses
            };

        } catch (error) {
            this.logger.error('Error getting recent analyses:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export default new TransactionAnalysisService(); 