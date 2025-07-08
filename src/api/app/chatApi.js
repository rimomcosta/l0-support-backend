// src/api/app/chatApi.js
import express from 'express';
import chatAgent from '../../services/ai/agents/chat.js';
import { logger } from '../../services/logger.js';
import { ChatDao } from '../../services/dao/chatDao.js';
import { FeedbackDao } from '../../services/dao/feedbackDao.js';

const router = express.Router();



/**
 * GET /api/v1/ai/chat/:chatId
 * Return all messages in the chat with the given chatId.
 */
export async function getChatMessages(req, res) {
  try {
    const { chatId } = req.params;
    if (!chatId) {
      return res.status(400).json({ error: 'Missing chatId' });
    }

    const exists = await ChatDao.chatSessionExists(chatId);
    if (!exists) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const messages = await ChatDao.getMessagesByChatId(chatId);
    res.json({ messages });
  } catch (error) {
    logger.error('Failed to get chat messages:', {
      error: error.message,
      chatId: req.params.chatId
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Get all chats for a user
router.get('/chats', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { projectId, environment } = req.query;
    
    // TODO: Implement get chats from database
    res.json({ chats: [] });
  } catch (error) {
    logger.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Create a new chat session
router.post('/chats', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const chatId = await chatAgent.createNewChatSession(userId);
    res.json({ chatId });
  } catch (error) {
    logger.error('Error creating chat session:', error);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

// Submit feedback for a message
router.post('/feedback', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { messageId, chatId, feedbackType, reasons, additionalFeedback } = req.body;
    
    // Validate input
    if (!messageId || !chatId || !feedbackType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!['helpful', 'not_helpful'].includes(feedbackType)) {
      return res.status(400).json({ error: 'Invalid feedback type' });
    }
    
    // Save feedback to database
    const success = await FeedbackDao.saveFeedback(
      userId,
      chatId,
      messageId,
      feedbackType,
      reasons,
      additionalFeedback
    );
    
    if (success) {
      logger.info('Feedback saved successfully:', {
        userId,
        messageId,
        chatId,
        feedbackType,
        reasons: reasons?.length || 0,
        hasAdditionalFeedback: !!additionalFeedback,
        timestamp: new Date()
      });
      
      res.json({ success: true });
    } else {
      logger.error('Failed to save feedback to database');
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  } catch (error) {
    logger.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Get feedback for a specific chat
router.get('/feedback/chat/:chatId', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { chatId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required' });
    }
    
    const feedback = await FeedbackDao.getChatFeedback(userId, chatId);
    
    res.json({ feedback });
  } catch (error) {
    logger.error('Error fetching chat feedback:', error);
    res.status(500).json({ error: 'Failed to fetch chat feedback' });
  }
});

// Get feedback for a specific message
router.get('/feedback/message/:messageId', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { messageId } = req.params;
    
    const feedback = await FeedbackDao.getFeedback(userId, messageId);
    
    res.json({ feedback });
  } catch (error) {
    logger.error('Error fetching message feedback:', error);
    res.status(500).json({ error: 'Failed to fetch message feedback' });
  }
});

// Get feedback statistics
router.get('/feedback/stats', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    const { global } = req.query;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Check if requesting global stats
    if (global === 'true') {
      // Check if user is admin for global stats
      const isAdmin = user?.role === 'admin' || 
                     user?.isAdmin || 
                     user?.groups?.includes('GRP-L0SUPPORT-ADMIN');
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Access denied. Admin privileges required for global statistics.' });
      }
    }
    
    // Get statistics (user-specific or global)
    const stats = global === 'true' 
      ? await FeedbackDao.getGlobalFeedbackStats()
      : await FeedbackDao.getUserFeedbackStats(userId);
    
    // Get top reasons (global for admins, user-specific otherwise)
    const topReasons = global === 'true'
      ? await FeedbackDao.getTopReasons(null, 10)
      : await FeedbackDao.getTopReasons(null, 10); // Could be filtered by user if needed
    
    res.json({
      ...stats,
      topReasons
    });
  } catch (error) {
    logger.error('Error fetching feedback stats:', error);
    res.status(500).json({ error: 'Failed to fetch feedback statistics' });
  }
});

// Get recent feedback (admin/global view)
router.get('/feedback/recent', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Check if user is admin
    const isAdmin = user?.role === 'admin' || 
                   user?.isAdmin || 
                   user?.groups?.includes('GRP-L0SUPPORT-ADMIN');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    
    const { limit = 50 } = req.query;
    
    const recentFeedback = await FeedbackDao.getRecentFeedback(parseInt(limit));
    
    res.json({ feedback: recentFeedback });
  } catch (error) {
    logger.error('Error fetching recent feedback:', error);
    res.status(500).json({ error: 'Failed to fetch recent feedback' });
  }
});

// Get all flagged messages (admin-only)
router.get('/feedback/flagged', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Check if user is admin
    const isAdmin = user?.role === 'admin' || 
                   user?.isAdmin || 
                   user?.groups?.includes('GRP-L0SUPPORT-ADMIN');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    
    const flaggedMessages = await FeedbackDao.getFlaggedMessages();
    
    res.json({ messages: flaggedMessages });
  } catch (error) {
    logger.error('Error fetching flagged messages:', error);
    res.status(500).json({ error: 'Failed to fetch flagged messages' });
  }
});

// Delete feedback entry (admin-only)
router.delete('/feedback/:feedbackId', async (req, res) => {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    const { feedbackId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    // Check if user is admin
    const isAdmin = user?.role === 'admin' || 
                   user?.isAdmin || 
                   user?.groups?.includes('GRP-L0SUPPORT-ADMIN');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    
    if (!feedbackId) {
      return res.status(400).json({ error: 'Feedback ID is required' });
    }
    
    const success = await FeedbackDao.deleteFeedbackById(parseInt(feedbackId));
    
    if (success) {
      logger.info('Feedback deleted successfully by admin:', {
        feedbackId,
        deletedBy: userId,
        timestamp: new Date()
      });
      
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Feedback not found' });
    }
  } catch (error) {
    logger.error('Error deleting feedback:', error);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

export default router;
