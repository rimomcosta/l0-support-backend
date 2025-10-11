// src/api/core/tokenUsage.js
import { TokenQuotaService } from '../../services/tokenQuotaService.js';
import { logger } from '../../services/logger.js';

/**
 * GET /api/v1/token-usage/current
 * Get current day's token usage for the authenticated user
 */
export async function getCurrentUsage(req, res) {
    try {
        const userId = req.session?.user?.id || req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        const usage = await TokenQuotaService.getUserUsageStats(userId);

        res.status(200).json({
            success: true,
            usage
        });
    } catch (error) {
        logger.error('Error getting current token usage:', {
            error: error.message,
            userId: req.session?.user?.id || req.user?.id
        });
        res.status(500).json({
            success: false,
            error: 'Failed to get token usage'
        });
    }
}

/**
 * GET /api/v1/token-usage/history
 * Get token usage history for the authenticated user
 */
export async function getUsageHistory(req, res) {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const { days = 7 } = req.query;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        const history = await TokenQuotaService.getUserUsageHistory(userId, parseInt(days));

        res.status(200).json({
            success: true,
            history
        });
    } catch (error) {
        logger.error('Error getting token usage history:', {
            error: error.message,
            userId: req.session?.user?.id || req.user?.id,
            days: req.query.days
        });
        res.status(500).json({
            success: false,
            error: 'Failed to get token usage history'
        });
    }
}

/**
 * PUT /api/v1/admin/token-usage/:userId/limit
 * Update daily token limit for a user (admin only)
 */
export async function updateUserLimit(req, res) {
    try {
        const requestingUser = req.session?.user || req.user;
        const { userId } = req.params;
        const { limit } = req.body;

        if (!requestingUser) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Check if requesting user is admin
        const isAdmin = requestingUser.role === 'admin' || 
                       requestingUser.isAdmin || 
                       requestingUser.groups?.includes('GRP-L0SUPPORT-ADMIN');

        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Admin privileges required'
            });
        }

        if (!limit || typeof limit !== 'number' || limit < 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid limit value'
            });
        }

        const success = await TokenQuotaService.updateUserLimit(userId, limit);

        if (success) {
            logger.info('Token limit updated by admin:', {
                adminId: requestingUser.id,
                targetUserId: userId,
                newLimit: limit
            });

            res.status(200).json({
                success: true,
                message: 'Token limit updated successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to update token limit'
            });
        }
    } catch (error) {
        logger.error('Error updating user token limit:', {
            error: error.message,
            adminId: req.session?.user?.id || req.user?.id,
            targetUserId: req.params.userId
        });
        res.status(500).json({
            success: false,
            error: 'Failed to update token limit'
        });
    }
}

