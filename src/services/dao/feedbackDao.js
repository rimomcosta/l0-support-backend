import { pool } from '../../config/database.js';

export class FeedbackDao {
  /**
   * Save or update feedback for a message
   */
  static async saveFeedback(userId, chatId, messageId, feedbackType, reasons = null, additionalFeedback = null) {
    const sql = `
      INSERT INTO feedback (user_id, chat_id, message_id, feedback_type, reasons, additional_feedback)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        feedback_type = VALUES(feedback_type),
        reasons = VALUES(reasons),
        additional_feedback = VALUES(additional_feedback),
        updated_at = CURRENT_TIMESTAMP
    `;
    
    const reasonsJson = reasons && reasons.length > 0 ? JSON.stringify(reasons) : null;
    
    const [result] = await pool.query(sql, [
      userId,
      chatId,
      messageId,
      feedbackType,
      reasonsJson,
      additionalFeedback
    ]);
    
    return result.insertId || result.affectedRows > 0;
  }

  /**
   * Get feedback for a specific message
   */
  static async getFeedback(userId, messageId) {
    const sql = `
      SELECT feedback_type, reasons, additional_feedback, created_at, updated_at
      FROM feedback
      WHERE user_id = ? AND message_id = ?
    `;
    
    const [rows] = await pool.query(sql, [userId, messageId]);
    
    if (rows.length === 0) {
      return null;
    }
    
    const feedback = rows[0];
    return {
      ...feedback,
      reasons: feedback.reasons ? JSON.parse(feedback.reasons) : null
    };
  }

  /**
   * Get all feedback for a chat session
   */
  static async getChatFeedback(userId, chatId) {
    const sql = `
      SELECT message_id, feedback_type, reasons, additional_feedback, created_at, updated_at
      FROM feedback
      WHERE user_id = ? AND chat_id = ?
      ORDER BY created_at DESC
    `;
    
    const [rows] = await pool.query(sql, [userId, chatId]);
    
    return rows.map(feedback => ({
      ...feedback,
      reasons: feedback.reasons ? JSON.parse(feedback.reasons) : null
    }));
  }

  /**
   * Get feedback statistics for a user
   */
  static async getUserFeedbackStats(userId) {
    const sql = `
      SELECT 
        COUNT(*) as total_feedback,
        SUM(CASE WHEN feedback_type = 'helpful' THEN 1 ELSE 0 END) as helpful_count,
        SUM(CASE WHEN feedback_type = 'not_helpful' THEN 1 ELSE 0 END) as not_helpful_count
      FROM feedback
      WHERE user_id = ?
    `;
    
    const [rows] = await pool.query(sql, [userId]);
    
    return {
      totalFeedback: rows[0].total_feedback || 0,
      helpful: rows[0].helpful_count || 0,
      notHelpful: rows[0].not_helpful_count || 0
    };
  }

  /**
   * Get global feedback statistics
   */
  static async getGlobalFeedbackStats() {
    const sql = `
      SELECT 
        COUNT(*) as total_feedback,
        SUM(CASE WHEN feedback_type = 'helpful' THEN 1 ELSE 0 END) as helpful_count,
        SUM(CASE WHEN feedback_type = 'not_helpful' THEN 1 ELSE 0 END) as not_helpful_count
      FROM feedback
    `;
    
    const [rows] = await pool.query(sql);
    
    return {
      totalFeedback: rows[0].total_feedback || 0,
      helpful: rows[0].helpful_count || 0,
      notHelpful: rows[0].not_helpful_count || 0
    };
  }

  /**
   * Get top feedback reasons
   */
  static async getTopReasons(feedbackType = null, limit = 10) {
    let sql = `
      SELECT reasons
      FROM feedback
      WHERE reasons IS NOT NULL
    `;
    
    const params = [];
    
    if (feedbackType) {
      sql += ` AND feedback_type = ?`;
      params.push(feedbackType);
    }
    
    const [rows] = await pool.query(sql, params);
    
    // Parse and aggregate reasons
    const reasonCounts = {};
    
    rows.forEach(row => {
      if (row.reasons) {
        const reasons = JSON.parse(row.reasons);
        if (Array.isArray(reasons)) {
          reasons.forEach(reason => {
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
          });
        }
      }
    });
    
    // Sort by count and return top reasons
    return Object.entries(reasonCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([reason, count]) => ({ reason, count }));
  }

  /**
   * Get recent feedback with details
   */
  static async getRecentFeedback(limit = 50) {
    const sql = `
      SELECT 
        f.id,
        f.user_id,
        f.chat_id,
        f.message_id,
        f.feedback_type,
        f.reasons,
        f.additional_feedback,
        f.created_at,
        u.username,
        u.email
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.user_id
      ORDER BY f.created_at DESC
      LIMIT ?
    `;
    
    const [rows] = await pool.query(sql, [limit]);
    
    return rows.map(feedback => ({
      ...feedback,
      reasons: feedback.reasons ? JSON.parse(feedback.reasons) : null
    }));
  }

  /**
   * Delete feedback for a message
   */
  static async deleteFeedback(userId, messageId) {
    const sql = `
      DELETE FROM feedback
      WHERE user_id = ? AND message_id = ?
    `;
    
    const [result] = await pool.query(sql, [userId, messageId]);
    
    return result.affectedRows > 0;
  }

  /**
   * Delete feedback by ID (admin only)
   */
  static async deleteFeedbackById(feedbackId) {
    const sql = `
      DELETE FROM feedback
      WHERE id = ?
    `;
    
    const [result] = await pool.query(sql, [feedbackId]);
    
    return result.affectedRows > 0;
  }

  /**
   * Get all messages flagged as 'not_helpful'
   */
  static async getFlaggedMessages() {
    const sql = `
      SELECT 
        f.id,
        f.chat_id,
        f.message_id,
        f.reasons,
        f.additional_feedback,
        f.created_at AS flagged_at,
        u.username AS flagged_by,
        cm.content
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.user_id
      LEFT JOIN chat_messages cm ON f.message_id = cm.id -- This assumes message_id in feedback corresponds to id in chat_messages
      WHERE f.feedback_type = 'not_helpful'
      ORDER BY f.created_at DESC
    `;
    
    const [rows] = await pool.query(sql);
    
    return rows.map(feedback => ({
      ...feedback,
      reasons: feedback.reasons ? JSON.parse(feedback.reasons) : null
    }));
  }
} 