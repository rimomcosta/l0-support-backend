// src/api/app/chatApi.js
import { ChatDao } from '../../services/dao/chatDao.js';
import { logger } from '../../services/logger.js';

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
