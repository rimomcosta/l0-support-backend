// src/services/chatManagementService.js
import chatAgent from './ai/agents/chat.js';
import { logger } from './logger.js';
import { ChatDao } from './dao/chatDao.js';
import { FeedbackDao } from './dao/feedbackDao.js';

export class ChatManagementService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validate chat ID
     * @param {string} chatId - Chat ID to validate
     * @returns {Object} - Validation result
     */
    validateChatId(chatId) {
        if (!chatId) {
            return {
                valid: false,
                error: 'Missing chatId'
            };
        }
        return { valid: true };
    }

    /**
     * Validate feedback input
     * @param {Object} feedbackData - Feedback data to validate
     * @returns {Object} - Validation result
     */
    validateFeedbackInput(feedbackData) {
        const { messageId, chatId, feedbackType } = feedbackData;
        
        if (!messageId || !chatId || !feedbackType) {
            return {
                valid: false,
                error: 'Missing required fields'
            };
        }
        
        if (!['helpful', 'not_helpful'].includes(feedbackType)) {
            return {
                valid: false,
                error: 'Invalid feedback type'
            };
        }
        
        return { valid: true };
    }

    /**
     * Check if user is admin
     * @param {Object} user - User object
     * @returns {boolean} - Whether user is admin
     */
    isUserAdmin(user) {
        return user?.role === 'admin' || 
               user?.isAdmin || 
               user?.groups?.includes('GRP-L0SUPPORT-ADMIN');
    }

    /**
     * Get chat messages by chat ID
     * @param {string} chatId - Chat ID
     * @returns {Object} - Result with messages or error
     */
    async getChatMessages(chatId) {
        try {
            const validation = this.validateChatId(chatId);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error,
                    statusCode: 400
                };
            }

            const exists = await ChatDao.chatSessionExists(chatId);
            if (!exists) {
                return {
                    success: false,
                    error: 'Chat session not found',
                    statusCode: 404
                };
            }

            const messages = await ChatDao.getMessagesByChatId(chatId);
            return {
                success: true,
                messages,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Failed to get chat messages:', {
                error: error.message,
                chatId
            });
            return {
                success: false,
                error: 'Internal server error',
                statusCode: 500
            };
        }
    }

    /**
     * Get all chats for a user
     * @param {string} userId - User ID
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment
     * @returns {Object} - Result with chats or error
     */
    async getUserChats(userId, projectId, environment) {
        try {
            // TODO: Implement get chats from database
            return {
                success: true,
                chats: [],
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error fetching chats:', error);
            return {
                success: false,
                error: 'Failed to fetch chats',
                statusCode: 500
            };
        }
    }

    /**
     * Create a new chat session
     * @param {string} userId - User ID
     * @returns {Object} - Result with chat ID or error
     */
    async createChatSession(userId) {
        try {
            const chatId = await chatAgent.createNewChatSession(userId);
            return {
                success: true,
                chatId,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error creating chat session:', error);
            return {
                success: false,
                error: 'Failed to create chat session',
                statusCode: 500
            };
        }
    }

    /**
     * Submit feedback for a message
     * @param {string} userId - User ID
     * @param {Object} feedbackData - Feedback data
     * @returns {Object} - Result with success or error
     */
    async submitFeedback(userId, feedbackData) {
        try {
            const validation = this.validateFeedbackInput(feedbackData);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error,
                    statusCode: 400
                };
            }

            const { messageId, chatId, feedbackType, reasons, additionalFeedback } = feedbackData;
            
            const success = await FeedbackDao.saveFeedback(
                userId,
                chatId,
                messageId,
                feedbackType,
                reasons,
                additionalFeedback
            );
            
            if (success) {
                this.logger.info('Feedback saved successfully:', {
                    userId,
                    messageId,
                    chatId,
                    feedbackType,
                    reasons: reasons?.length || 0,
                    hasAdditionalFeedback: !!additionalFeedback,
                    timestamp: new Date()
                });
                
                return {
                    success: true,
                    statusCode: 200
                };
            } else {
                this.logger.error('Failed to save feedback to database');
                return {
                    success: false,
                    error: 'Failed to save feedback',
                    statusCode: 500
                };
            }
        } catch (error) {
            this.logger.error('Error submitting feedback:', error);
            return {
                success: false,
                error: 'Failed to submit feedback',
                statusCode: 500
            };
        }
    }

    /**
     * Get feedback for a specific chat
     * @param {string} userId - User ID
     * @param {string} chatId - Chat ID
     * @returns {Object} - Result with feedback or error
     */
    async getChatFeedback(userId, chatId) {
        try {
            if (!userId) {
                return {
                    success: false,
                    error: 'User not authenticated',
                    statusCode: 401
                };
            }
            
            if (!chatId) {
                return {
                    success: false,
                    error: 'Chat ID is required',
                    statusCode: 400
                };
            }
            
            const feedback = await FeedbackDao.getChatFeedback(userId, chatId);
            return {
                success: true,
                feedback,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error fetching chat feedback:', error);
            return {
                success: false,
                error: 'Failed to fetch chat feedback',
                statusCode: 500
            };
        }
    }

    /**
     * Get feedback for a specific message
     * @param {string} userId - User ID
     * @param {string} messageId - Message ID
     * @returns {Object} - Result with feedback or error
     */
    async getMessageFeedback(userId, messageId) {
        try {
            const feedback = await FeedbackDao.getFeedback(userId, messageId);
            return {
                success: true,
                feedback,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error fetching message feedback:', error);
            return {
                success: false,
                error: 'Failed to fetch message feedback',
                statusCode: 500
            };
        }
    }

    /**
     * Get feedback statistics
     * @param {string} userId - User ID
     * @param {Object} user - User object
     * @param {boolean} global - Whether to get global stats
     * @returns {Object} - Result with statistics or error
     */
    async getFeedbackStats(userId, user, global) {
        try {
            if (!userId) {
                return {
                    success: false,
                    error: 'User not authenticated',
                    statusCode: 401
                };
            }
            
            // Check if requesting global stats
            if (global === true) {
                // Check if user is admin for global stats
                const isAdmin = this.isUserAdmin(user);
                
                if (!isAdmin) {
                    return {
                        success: false,
                        error: 'Access denied. Admin privileges required for global statistics.',
                        statusCode: 403
                    };
                }
            }
            
            // Get statistics (user-specific or global)
            const stats = global === true 
                ? await FeedbackDao.getGlobalFeedbackStats()
                : await FeedbackDao.getUserFeedbackStats(userId);
            
            // Get top reasons (global for admins, user-specific otherwise)
            const topReasons = global === true
                ? await FeedbackDao.getTopReasons(null, 10)
                : await FeedbackDao.getTopReasons(null, 10); // Could be filtered by user if needed
            
            return {
                success: true,
                data: {
                    ...stats,
                    topReasons
                },
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error fetching feedback stats:', error);
            return {
                success: false,
                error: 'Failed to fetch feedback statistics',
                statusCode: 500
            };
        }
    }

    /**
     * Get recent feedback (admin-only)
     * @param {string} userId - User ID
     * @param {Object} user - User object
     * @param {number} limit - Limit for results
     * @returns {Object} - Result with recent feedback or error
     */
    async getRecentFeedback(userId, user, limit = 50) {
        try {
            if (!userId) {
                return {
                    success: false,
                    error: 'User not authenticated',
                    statusCode: 401
                };
            }
            
            // Check if user is admin
            const isAdmin = this.isUserAdmin(user);
            
            if (!isAdmin) {
                return {
                    success: false,
                    error: 'Access denied. Admin privileges required.',
                    statusCode: 403
                };
            }
            
            const recentFeedback = await FeedbackDao.getRecentFeedback(parseInt(limit));
            return {
                success: true,
                feedback: recentFeedback,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error fetching recent feedback:', error);
            return {
                success: false,
                error: 'Failed to fetch recent feedback',
                statusCode: 500
            };
        }
    }

    /**
     * Get all flagged messages (admin-only)
     * @param {string} userId - User ID
     * @param {Object} user - User object
     * @returns {Object} - Result with flagged messages or error
     */
    async getFlaggedMessages(userId, user) {
        try {
            if (!userId) {
                return {
                    success: false,
                    error: 'User not authenticated',
                    statusCode: 401
                };
            }
            
            // Check if user is admin
            const isAdmin = this.isUserAdmin(user);
            
            if (!isAdmin) {
                return {
                    success: false,
                    error: 'Access denied. Admin privileges required.',
                    statusCode: 403
                };
            }
            
            const flaggedMessages = await FeedbackDao.getFlaggedMessages();
            return {
                success: true,
                messages: flaggedMessages,
                statusCode: 200
            };
        } catch (error) {
            this.logger.error('Error fetching flagged messages:', error);
            return {
                success: false,
                error: 'Failed to fetch flagged messages',
                statusCode: 500
            };
        }
    }

    /**
     * Delete feedback entry (admin-only)
     * @param {string} userId - User ID
     * @param {Object} user - User object
     * @param {string} feedbackId - Feedback ID
     * @returns {Object} - Result with success or error
     */
    async deleteFeedback(userId, user, feedbackId) {
        try {
            if (!userId) {
                return {
                    success: false,
                    error: 'User not authenticated',
                    statusCode: 401
                };
            }
            
            // Check if user is admin
            const isAdmin = this.isUserAdmin(user);
            
            if (!isAdmin) {
                return {
                    success: false,
                    error: 'Access denied. Admin privileges required.',
                    statusCode: 403
                };
            }
            
            if (!feedbackId) {
                return {
                    success: false,
                    error: 'Feedback ID is required',
                    statusCode: 400
                };
            }
            
            const success = await FeedbackDao.deleteFeedbackById(parseInt(feedbackId));
            
            if (success) {
                this.logger.info('Feedback deleted successfully by admin:', {
                    feedbackId,
                    deletedBy: userId,
                    timestamp: new Date()
                });
                
                return {
                    success: true,
                    statusCode: 200
                };
            } else {
                return {
                    success: false,
                    error: 'Feedback not found',
                    statusCode: 404
                };
            }
        } catch (error) {
            this.logger.error('Error deleting feedback:', error);
            return {
                success: false,
                error: 'Failed to delete feedback',
                statusCode: 500
            };
        }
    }
}
