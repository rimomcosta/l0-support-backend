import express from 'express';
import * as chatController from '../api/app/chatApi.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Get all chats for a user
router.get('/chats', requireAuth, chatController.getUserChats);

// Create a new chat session
router.post('/chats', requireAuth, chatController.createChatSession);

// Submit feedback for a message
router.post('/feedback', requireAuth, chatController.submitFeedback);

// Get feedback for a specific chat
router.get('/feedback/chat/:chatId', requireAuth, chatController.getChatFeedback);

// Get feedback for a specific message
router.get('/feedback/message/:messageId', requireAuth, chatController.getMessageFeedback);

// Get feedback statistics
router.get('/feedback/stats', requireAuth, chatController.getFeedbackStats);

// Get recent feedback (admin-only)
router.get('/feedback/recent', requireAuth, chatController.getRecentFeedback);

// Get all flagged messages (admin-only)
router.get('/feedback/flagged', requireAuth, chatController.getFlaggedMessages);

// Delete feedback entry (admin-only)
router.delete('/feedback/:feedbackId', requireAuth, chatController.deleteFeedback);

// Update chat title
router.put('/chats/:chatId/title', requireAuth, chatController.updateChatTitle);

// Delete chat
router.delete('/chats/:chatId', requireAuth, chatController.deleteChat);

export default router;
