// src/api/app/chatApi.js
import express from 'express';
import chatAgent from '../../services/ai/agents/chat.js';
import { logger } from '../../services/logger.js';
import { ChatDao } from '../../services/dao/chatDao.js';

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
    const userId = req.user.id;
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
    const userId = req.user.id;
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
    const userId = req.user.id;
    const { messageId, chatId, feedbackType, reasons, additionalFeedback } = req.body;
    
    // Validate input
    if (!messageId || !chatId || !feedbackType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!['helpful', 'not_helpful'].includes(feedbackType)) {
      return res.status(400).json({ error: 'Invalid feedback type' });
    }
    
    // Log feedback for now (TODO: Save to database)
    logger.info('Feedback received:', {
      userId,
      messageId,
      chatId,
      feedbackType,
      reasons,
      additionalFeedback,
      timestamp: new Date()
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Get feedback statistics
router.get('/feedback/stats', async (req, res) => {
  try {
    // TODO: Implement feedback statistics from database
    res.json({
      totalFeedback: 0,
      helpful: 0,
      notHelpful: 0,
      topReasons: []
    });
  } catch (error) {
    logger.error('Error fetching feedback stats:', error);
    res.status(500).json({ error: 'Failed to fetch feedback statistics' });
  }
});

export default router;
