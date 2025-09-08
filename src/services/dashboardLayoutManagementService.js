// src/services/dashboardLayoutManagementService.js
import { pool } from '../config/database.js';
import { logger } from './logger.js';

export class DashboardLayoutManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate layouts data
     * @param {Object} layouts - Layouts data to validate
     * @returns {Object} - Validation result
     */
    validateLayoutsData(layouts) {
        if (!layouts) {
            return {
                valid: false,
                error: 'Layouts data is required'
            };
        }
        return { valid: true };
    }

    /**
     * Get dashboard layout for user
     * @param {string} userId - User ID
     * @returns {Object} - Result with layout data or error
     */
    async getDashboardLayout(userId) {
        try {
            const [rows] = await pool.execute(
                'SELECT layouts FROM dashboard_layouts WHERE user_id = ?',
                [userId]
            );

            // If no layout is found in the DB, return a default empty structure.
            if (rows.length === 0 || !rows[0].layouts) {
                return {
                    success: true,
                    data: {
                        layouts: null,
                        pinnedItems: [],
                        collapsedItems: {},
                        userModifiedMap: {}
                    },
                    statusCode: 200
                };
            }

            // The 'layouts' column is a JSON type, mysql2 driver automatically parses it.
            // The `layoutData` variable now holds the complete object: { layouts: {...}, pinnedItems: [...], ... }
            const layoutData = rows[0].layouts;

            // Directly return the properties of the stored object.
            return {
                success: true,
                data: {
                    layouts: layoutData.layouts || null,
                    pinnedItems: layoutData.pinnedItems || [],
                    collapsedItems: layoutData.collapsedItems || {},
                    userModifiedMap: layoutData.userModifiedMap || {}
                },
                statusCode: 200
            };

        } catch (error) {
            this.logger.error(`[GET LAYOUT - USER: ${userId}] Error fetching layout:`, { errorMessage: error.message });
            return {
                success: false,
                error: 'Failed to fetch dashboard layout',
                statusCode: 500
            };
        }
    }

    /**
     * Save dashboard layout for user
     * @param {string} userId - User ID
     * @param {Object} layoutData - Layout data to save
     * @returns {Object} - Result with success or error
     */
    async saveDashboardLayout(userId, layoutData) {
        try {
            const { layouts, pinnedItems = [], collapsedItems = {}, userModifiedMap = {} } = layoutData;

            const validation = this.validateLayoutsData(layouts);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error,
                    statusCode: 400
                };
            }

            // Consolidate the entire state into one object to be stored in the JSON column.
            const layoutDataToStore = { layouts, pinnedItems, collapsedItems, userModifiedMap };
            const stringifiedLayoutData = JSON.stringify(layoutDataToStore);

            await pool.execute(
                `INSERT INTO dashboard_layouts (user_id, layouts) 
                 VALUES (?, ?) 
                 ON DUPLICATE KEY UPDATE 
                 layouts = VALUES(layouts), 
                 updated_at = CURRENT_TIMESTAMP`,
                [userId, stringifiedLayoutData]
            );

            return {
                success: true,
                message: 'Dashboard layout saved successfully.',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error(`[SAVE LAYOUT - USER: ${userId}] Error saving dashboard layout:`, { errorMessage: error.message });
            return {
                success: false,
                error: 'Failed to save dashboard layout',
                statusCode: 500
            };
        }
    }

    /**
     * Delete dashboard layout for user
     * @param {string} userId - User ID
     * @returns {Object} - Result with success or error
     */
    async deleteDashboardLayout(userId) {
        try {
            await pool.execute(
                'DELETE FROM dashboard_layouts WHERE user_id = ?',
                [userId]
            );
            return {
                success: true,
                message: 'Dashboard layout reset successfully.',
                statusCode: 200
            };
        } catch (error) {
            this.logger.error(`[DELETE LAYOUT - USER: ${userId}] Error deleting dashboard layout:`, { errorMessage: error.message });
            return {
                success: false,
                error: 'Failed to delete dashboard layout',
                statusCode: 500
            };
        }
    }
}
