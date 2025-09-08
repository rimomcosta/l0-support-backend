// src/api/app/dashboardLayout.js
import { DashboardLayoutManagementService } from '../../services/dashboardLayoutManagementService.js';
import { logger } from '../../services/logger.js';

// GET dashboard layout for the authenticated user
export async function getDashboardLayout(req, res) {
    try {
        const userId = req.session.user.id;
        const dashboardService = new DashboardLayoutManagementService();
        const result = await dashboardService.getDashboardLayout(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            error: result.error
        });
    } catch (error) {
        logger.error(`[GET LAYOUT - USER: ${req.session.user.id}] Error fetching layout:`, { errorMessage: error.message });
        res.status(500).json({ error: 'Failed to fetch dashboard layout' });
    }
}

// POST (Save) dashboard layout for the authenticated user
export async function saveDashboardLayout(req, res) {
    try {
        const { layouts, pinnedItems = [], collapsedItems = {}, userModifiedMap = {} } = req.body;
        const userId = req.session.user.id;

        const dashboardService = new DashboardLayoutManagementService();
        const result = await dashboardService.saveDashboardLayout(userId, {
            layouts, pinnedItems, collapsedItems, userModifiedMap
        });
        
        res.status(result.statusCode).json(result.success ? {
            success: true,
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error(`[SAVE LAYOUT - USER: ${req.session?.user?.id}] Error saving dashboard layout:`, { errorMessage: error.message });
        res.status(500).json({ error: 'Failed to save dashboard layout' });
    }
}

// DELETE dashboard layout for the authenticated user
export async function deleteDashboardLayout(req, res) {
    try {
        const userId = req.session.user.id;
        const dashboardService = new DashboardLayoutManagementService();
        const result = await dashboardService.deleteDashboardLayout(userId);
        
        res.status(result.statusCode).json(result.success ? {
            success: true,
            message: result.message
        } : {
            error: result.error
        });
    } catch (error) {
        logger.error(`[DELETE LAYOUT - USER: ${req.session.user.id}] Error deleting dashboard layout:`, { errorMessage: error.message });
        res.status(500).json({ error: 'Failed to delete dashboard layout' });
    }
}
