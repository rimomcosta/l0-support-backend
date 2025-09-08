// src/api/core/aiSettings.js
import { AiSettingsManagementService } from '../../services/aiSettingsManagementService.js';
import { logger } from '../../services/logger.js';

// GET user AI settings
export async function getAiSettings(req, res) {
    try {
        const userId = req.session.user.id;
        
        const aiSettingsService = new AiSettingsManagementService();
        const result = await aiSettingsService.getAiSettings(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            success: false,
            error: result.error
        });
    } catch (error) {
        logger.error('Error fetching user AI settings:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch AI settings' 
        });
    }
}

// POST save user AI settings
export async function saveAiSettings(req, res) {
    try {
        const userId = req.session.user.id;
        const settings = req.body;
        
        const aiSettingsService = new AiSettingsManagementService();
        const result = await aiSettingsService.saveAiSettings(userId, settings);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            success: false,
            error: result.error
        });
    } catch (error) {
        logger.error('Error saving user AI settings:', {
            error: error.message,
            userId: req.session?.user?.id,
            body: req.body
        });
        res.status(500).json({ 
            success: false, 
            error: 'Failed to save AI settings' 
        });
    }
}

// POST reset user AI settings to defaults
export async function resetAiSettings(req, res) {
    try {
        const userId = req.session.user.id;
        
        const aiSettingsService = new AiSettingsManagementService();
        const result = await aiSettingsService.resetAiSettings(userId);
        
        res.status(result.statusCode).json(result.success ? result.data : {
            success: false,
            error: result.error
        });
    } catch (error) {
        logger.error('Error resetting user AI settings:', {
            error: error.message,
            userId: req.session?.user?.id
        });
        res.status(500).json({ 
            success: false, 
            error: 'Failed to reset AI settings' 
        });
    }
}