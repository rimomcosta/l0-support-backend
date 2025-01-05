// src/services/dao/chatDao.js
import { pool } from '../../config/database.js';
import { v4 as uuidv4 } from 'uuid';

export class ChatDao {
  /**
   * Create a new chat session
   */
  static async createChatSession(userId = null) {
    const chatId = uuidv4();

    const sql = `INSERT INTO chat_sessions (chat_id, user_id) VALUES (?, ?)`;
    await pool.query(sql, [chatId, userId]);

    return chatId;
  }

  /**
   * Save a single chat message
   */
  static async saveMessage(chatId, role, content) {
    const sql = `INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)`;
    await pool.query(sql, [chatId, role, content]);
  }

  /**
   * Retrieve all messages for a given chatId
   */
  static async getMessagesByChatId(chatId) {
    const sql = `
      SELECT id, role, content, UNIX_TIMESTAMP(created_at) * 1000 as created_at
      FROM chat_messages
      WHERE chat_id = ?
      ORDER BY id ASC
    `;
    const [rows] = await pool.query(sql, [chatId]);
    // Convert Unix timestamp to Date object during mapping
    return rows.map(row => ({
      ...row,
      created_at: new Date(row.created_at) 
    }));
  }

  /**
   * Check if a chat session exists
   */
  static async chatSessionExists(chatId) {
    const sql = `SELECT chat_id FROM chat_sessions WHERE chat_id = ? LIMIT 1`;
    const [rows] = await pool.query(sql, [chatId]);
    return rows.length > 0;
  }
}
