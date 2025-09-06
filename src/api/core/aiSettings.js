// src/api/core/aiSettings.js
import { AiSettingsDao } from '../../services/dao/aiSettingsDao.js';
import { logger } from '../../services/logger.js';

// GET user AI settings
export async function getAiSettings(req, res) {
    try {
        const userId = req.session.user.id;
        
        const settings = await AiSettingsDao.getUserSettings(userId);
        
        res.json({
            success: true,
            settings
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
        const { aiModel, responseStyle, responseLength } = req.body;
        
        if (!aiModel || !responseStyle || !responseLength) {
            return res.status(400).json({
                success: false,
                error: 'Missing required settings: aiModel, responseStyle, responseLength'
            });
        }

        const settings = { aiModel, responseStyle, responseLength };
        const success = await AiSettingsDao.saveUserSettings(userId, settings);
        
        if (success) {
            logger.info('User AI settings updated:', {
                userId,
                settings
            });
            
            res.json({
                success: true,
                message: 'AI settings saved successfully',
                settings
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to save AI settings'
            });
        }
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
        
        const success = await AiSettingsDao.resetUserSettings(userId);
        
        if (success) {
            // Get the default settings
            const settings = await AiSettingsDao.getUserSettings(userId);
            
            logger.info('User AI settings reset:', { userId });
            
            res.json({
                success: true,
                message: 'AI settings reset to defaults',
                settings
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to reset AI settings'
            });
        }
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
