// src/services/dao/chatDao.js
import { pool } from '../../config/database.js';
import { v4 as uuidv4 } from 'uuid';

export class ChatDao {
  /**
   * Create a new chat session
   */
  static async createChatSession(userId = null, chatId = null, projectId = null, environment = null, title = 'New Chat') {
    const finalChatId = chatId || uuidv4();

    const sql = `INSERT INTO chat_sessions (chat_id, user_id, project_id, environment, title) VALUES (?, ?, ?, ?, ?)`;
    await pool.query(sql, [finalChatId, userId, projectId, environment, title]);

    return finalChatId;
  }

  /**
   * Save a single chat message
   */
  static async saveMessage(chatId, role, content) {
    const sql = `INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)`;
    const [result] = await pool.query(sql, [chatId, role, content]);
    // Return the inserted message ID so callers can reference it
    return result.insertId;
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
      id: row.id,
      created_at: new Date(row.created_at) 
    }));
  }

  /**
   * Get a single chat session by chatId
   */
  static async getChatSession(chatId) {
    const sql = `
      SELECT chat_id, user_id, project_id, environment, title, created_at, updated_at
      FROM chat_sessions 
      WHERE chat_id = ?
    `;
    const [rows] = await pool.query(sql, [chatId]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      chatId: row.chat_id,
      userId: row.user_id,
      projectId: row.project_id,
      environment: row.environment,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get all chat sessions for a user
   */
  static async getUserChatSessions(userId) {
    const sql = `
      SELECT chat_id, project_id, environment, title, created_at, updated_at
      FROM chat_sessions 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;
    const [rows] = await pool.query(sql, [userId]);
    return rows.map(row => ({
      chatId: row.chat_id,
      projectId: row.project_id,
      environment: row.environment,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  /**
   * Update chat session title
   */
  static async updateChatTitle(chatId, title) {
    const sql = `UPDATE chat_sessions SET title = ?, updated_at = NOW() WHERE chat_id = ?`;
    const [result] = await pool.query(sql, [title, chatId]);
    return result.affectedRows > 0;
  }

  /**
   * Check if a chat session exists
   */
  static async chatSessionExists(chatId) {
    const sql = `SELECT chat_id FROM chat_sessions WHERE chat_id = ? LIMIT 1`;
    const [rows] = await pool.query(sql, [chatId]);
    return rows.length > 0;
  }

  /**
   * Delete a chat session and all its messages
   */
  static async deleteChatSession(chatId) {
    try {
      // First delete all messages for this chat
      const deleteMessagesSql = `DELETE FROM chat_messages WHERE chat_id = ?`;
      await pool.query(deleteMessagesSql, [chatId]);
      
      // Then delete the chat session
      const deleteSessionSql = `DELETE FROM chat_sessions WHERE chat_id = ?`;
      const [result] = await pool.query(deleteSessionSql, [chatId]);
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting chat session:', error);
      throw error;
    }
  }
}
