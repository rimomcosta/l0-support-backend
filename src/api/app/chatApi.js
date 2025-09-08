// src/api/app/chatApi.js
import { ChatManagementService } from '../../services/chatManagementService.js';
import { logger } from '../../services/logger.js';



/**
 * GET /api/v1/ai/chat/:chatId
 * Return all messages in the chat with the given chatId.
 */
export async function getChatMessages(req, res) {
  try {
    const { chatId } = req.params;
    const chatService = new ChatManagementService();
    const result = await chatService.getChatMessages(chatId);
    
    res.status(result.statusCode).json(result.success ? { messages: result.messages } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Failed to get chat messages:', {
      error: error.message,
      chatId: req.params.chatId
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Get all chats for a user
export async function getUserChats(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { projectId, environment } = req.query;
    
    const chatService = new ChatManagementService();
    const result = await chatService.getUserChats(userId, projectId, environment);
    
    res.status(result.statusCode).json(result.success ? { chats: result.chats } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
}

// Create a new chat session
export async function createChatSession(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    
    const chatService = new ChatManagementService();
    const result = await chatService.createChatSession(userId);
    
    res.status(result.statusCode).json(result.success ? { chatId: result.chatId } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error creating chat session:', error);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
}

// Submit feedback for a message
export async function submitFeedback(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { messageId, chatId, feedbackType, reasons, additionalFeedback } = req.body;
    
    const chatService = new ChatManagementService();
    const result = await chatService.submitFeedback(userId, {
      messageId, chatId, feedbackType, reasons, additionalFeedback
    });
    
    res.status(result.statusCode).json(result.success ? { success: true } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
}

// Get feedback for a specific chat
export async function getChatFeedback(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { chatId } = req.params;
    
    const chatService = new ChatManagementService();
    const result = await chatService.getChatFeedback(userId, chatId);
    
    res.status(result.statusCode).json(result.success ? { feedback: result.feedback } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error fetching chat feedback:', error);
    res.status(500).json({ error: 'Failed to fetch chat feedback' });
  }
}

// Get feedback for a specific message
export async function getMessageFeedback(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const { messageId } = req.params;
    
    const chatService = new ChatManagementService();
    const result = await chatService.getMessageFeedback(userId, messageId);
    
    res.status(result.statusCode).json(result.success ? { feedback: result.feedback } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error fetching message feedback:', error);
    res.status(500).json({ error: 'Failed to fetch message feedback' });
  }
}

// Get feedback statistics
export async function getFeedbackStats(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    const { global } = req.query;
    
    const chatService = new ChatManagementService();
    const result = await chatService.getFeedbackStats(userId, user, global === 'true');
    
    res.status(result.statusCode).json(result.success ? result.data : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error fetching feedback stats:', error);
    res.status(500).json({ error: 'Failed to fetch feedback statistics' });
  }
}

// Get recent feedback (admin/global view)
export async function getRecentFeedback(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    const { limit = 50 } = req.query;
    
    const chatService = new ChatManagementService();
    const result = await chatService.getRecentFeedback(userId, user, parseInt(limit));
    
    res.status(result.statusCode).json(result.success ? { feedback: result.feedback } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error fetching recent feedback:', error);
    res.status(500).json({ error: 'Failed to fetch recent feedback' });
  }
}

// Get all flagged messages (admin-only)
export async function getFlaggedMessages(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    
    const chatService = new ChatManagementService();
    const result = await chatService.getFlaggedMessages(userId, user);
    
    res.status(result.statusCode).json(result.success ? { messages: result.messages } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error fetching flagged messages:', error);
    res.status(500).json({ error: 'Failed to fetch flagged messages' });
  }
}

// Delete feedback entry (admin-only)
export async function deleteFeedback(req, res) {
  try {
    const userId = req.session?.user?.id || req.user?.id;
    const user = req.session?.user || req.user;
    const { feedbackId } = req.params;
    
    const chatService = new ChatManagementService();
    const result = await chatService.deleteFeedback(userId, user, feedbackId);
    
    res.status(result.statusCode).json(result.success ? { success: true } : {
      error: result.error
    });
  } catch (error) {
    logger.error('Error deleting feedback:', error);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
}
