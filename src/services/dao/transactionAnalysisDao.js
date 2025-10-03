import { logger } from '../logger.js';
import { pool as database } from '../../config/database.js';

class TransactionAnalysisDao {
    constructor() {
        this.logger = logger;
    }

    async createAnalysis(analysisData) {
        try {
            const {
                projectId,
                environment,
                userId,
                analysisName,
                extraContext = null,
                originalPayload,
                analysisResult,
                status = 'pending',
                errorMessage = null,
                tokenCount = 0,
                processingTimeMs = 0,
                useAi = true  // Default to selected (true)
            } = analysisData;

            const query = `
                INSERT INTO transaction_analysis 
                (project_id, environment, user_id, analysis_name, extra_context, original_payload, analysis_result, status, error_message, token_count, processing_time_ms, use_ai)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                projectId,
                environment,
                userId,
                analysisName,
                extraContext,
                originalPayload,
                analysisResult,
                status,
                errorMessage,
                tokenCount,
                processingTimeMs,
                useAi
            ];

            const [result] = await database.execute(query, params);
            
            this.logger.info(`Created transaction analysis with ID: ${result.insertId}`);
            
            return {
                success: true,
                id: result.insertId,
                ...analysisData
            };

        } catch (error) {
            this.logger.error('Error creating transaction analysis:', error);
            throw error;
        }
    }

    async getAnalysisById(id) {
        try {
            const query = `
                SELECT * FROM transaction_analysis 
                WHERE id = ?
            `;

            const [rows] = await database.execute(query, [id]);
            
            if (rows.length === 0) {
                return null;
            }

            return rows[0];

        } catch (error) {
            this.logger.error('Error getting transaction analysis by ID:', error);
            throw error;
        }
    }

    async getAnalysesByProject(projectId, environment, limit = 50, offset = 0) {
        try {
            const query = `
                SELECT id, project_id, environment, user_id, analysis_name, status, 
                       created_at, updated_at, completed_at, token_count, processing_time_ms, use_ai
                FROM transaction_analysis 
                WHERE project_id = ? AND environment = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `;

            const [rows] = await database.execute(query, [projectId, environment, limit, offset]);
            
            return rows;

        } catch (error) {
            this.logger.error('Error getting transaction analyses by project:', error);
            throw error;
        }
    }

    async updateAnalysisStatus(id, status, analysisResult = null, errorMessage = null, processingTimeMs = null) {
        try {
            let query = `
                UPDATE transaction_analysis 
                SET status = ?, updated_at = CURRENT_TIMESTAMP
            `;
            
            const params = [status];

            if (analysisResult !== null) {
                query += `, analysis_result = ?, completed_at = CURRENT_TIMESTAMP`;
                params.push(analysisResult);
            }

            if (errorMessage !== null) {
                query += `, error_message = ?`;
                params.push(errorMessage);
            }

            if (processingTimeMs !== null) {
                query += `, processing_time_ms = ?`;
                params.push(processingTimeMs);
            }

            query += ` WHERE id = ?`;
            params.push(id);

            const [result] = await database.execute(query, params);
            
            if (result.affectedRows === 0) {
                throw new Error(`Analysis with ID ${id} not found`);
            }

            this.logger.info(`Updated transaction analysis ${id} status to ${status}`);
            
            return {
                success: true,
                affectedRows: result.affectedRows
            };

        } catch (error) {
            this.logger.error('Error updating transaction analysis status:', error);
            throw error;
        }
    }

    async updateAnalysisUseAi(id, useAi) {
        try {
            const query = `
                UPDATE transaction_analysis 
                SET use_ai = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;

            const [result] = await database.execute(query, [useAi, id]);
            
            if (result.affectedRows === 0) {
                throw new Error(`Analysis with ID ${id} not found`);
            }

            this.logger.info(`Updated transaction analysis ${id} use_ai to ${useAi}`);
            
            return {
                success: true,
                affectedRows: result.affectedRows
            };

        } catch (error) {
            this.logger.error('Error updating transaction analysis use_ai:', error);
            throw error;
        }
    }



    async deleteAnalysis(id) {
        try {
            const query = `
                DELETE FROM transaction_analysis 
                WHERE id = ?
            `;

            const [result] = await database.execute(query, [id]);
            
            if (result.affectedRows === 0) {
                throw new Error(`Analysis with ID ${id} not found`);
            }

            this.logger.info(`Deleted transaction analysis with ID: ${id}`);
            
            return {
                success: true,
                affectedRows: result.affectedRows
            };

        } catch (error) {
            this.logger.error('Error deleting transaction analysis:', error);
            throw error;
        }
    }



    async searchAnalyses(projectId, environment, searchTerm, limit = 20) {
        try {
            const query = `
                SELECT id, project_id, environment, user_id, analysis_name, status, 
                       created_at, updated_at, completed_at, token_count, processing_time_ms, use_ai
                FROM transaction_analysis 
                WHERE project_id = ? AND environment = ? 
                AND (analysis_name LIKE ? OR analysis_result LIKE ?)
                ORDER BY created_at DESC
                LIMIT ?
            `;

            const searchPattern = `%${searchTerm}%`;
            const [rows] = await database.execute(query, [projectId, environment, searchPattern, searchPattern, limit]);
            
            return rows;

        } catch (error) {
            this.logger.error('Error searching transaction analyses:', error);
            throw error;
        }
    }

    async getRecentAnalyses(limit = 10) {
        try {
            // Ensure limit is a safe integer to prevent SQL injection
            const safeLimit = Math.max(1, Math.min(100, parseInt(limit) || 10));
            
            const query = `
                SELECT id, project_id, environment, user_id, analysis_name, status, 
                       created_at, updated_at, completed_at, token_count, processing_time_ms, use_ai
                FROM transaction_analysis 
                ORDER BY created_at DESC
                LIMIT ${safeLimit}
            `;

            const [rows] = await database.execute(query);
            
            return rows;

        } catch (error) {
            this.logger.error('Error getting recent transaction analyses:', error);
            throw error;
        }
    }

    async getRecentAnalysesByProject(projectId, limit = 10) {
        try {
            // Ensure limit is a safe integer to prevent SQL injection
            const safeLimit = Math.max(1, Math.min(100, parseInt(limit) || 10));
            
            const query = `
                SELECT id, project_id, environment, user_id, analysis_name, status, 
                       created_at, updated_at, completed_at, token_count, processing_time_ms, use_ai
                FROM transaction_analysis 
                WHERE project_id = ?
                ORDER BY created_at DESC
                LIMIT ${safeLimit}
            `;

            const [rows] = await database.execute(query, [projectId]);
            
            return rows;

        } catch (error) {
            this.logger.error('Error getting recent transaction analyses by project:', error);
            throw error;
        }
    }

    async getStuckAnalyses() {
        try {
            const query = `
                SELECT id 
                FROM transaction_analysis 
                WHERE status = 'processing' 
                AND updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
            `;
            const [rows] = await database.execute(query);
            return rows;
        } catch (error) {
            this.logger.error('Error getting stuck analyses:', error);
            throw error;
        }
    }

    async getAnalysesForAiContext(projectId, environment, limit = 5) {
        try {
            // Ensure limit is a safe integer to prevent SQL injection
            const safeLimit = Math.max(1, Math.min(100, parseInt(limit) || 5));
            
            const query = `
                SELECT id, analysis_name, analysis_result, created_at, token_count
                FROM transaction_analysis 
                WHERE project_id = ? AND environment = ? AND use_ai = TRUE AND status = 'completed'
                ORDER BY created_at DESC
                LIMIT ${safeLimit}
            `;

            const [rows] = await database.execute(query, [projectId, environment]);
            
            return rows;

        } catch (error) {
            this.logger.error('Error getting analyses for AI context:', error);
            throw error;
        }
    }
}

export default new TransactionAnalysisDao(); 