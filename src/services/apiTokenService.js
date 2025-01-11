// src/services/apiTokenService.js
import { pool } from '../config/database.js';
import { logger } from './logger.js';

export class ApiTokenService {
    static async createUser(user) {
        const query = 'INSERT INTO users (user_id, username, email, api_token) VALUES (?, ?, ?, ?)';
        try {
            const [result] = await pool.execute(query, [user.user_id, user.username, user.email, user.api_token]);
            logger.info('User created', { userId: user.user_id });
            return result;
        } catch (error) {
            logger.error('Failed to create user:', {
                error: error.message,
                userId: user.user_id
            });
            throw error;
        }
    }

    static async getUserByEmail(email) {
        const query = 'SELECT * FROM users WHERE email = ?';
        try {
            const [rows] = await pool.execute(query, [email]);
            if (rows.length > 0) {
                return rows[0];
            }
            return null;
        } catch (error) {
            logger.error('Failed to get user by email:', {
                error: error.message,
                email
            });
            throw error;
        }
    }

    static async saveApiToken(userId, apiToken) {
        const query = 'UPDATE users SET api_token = ? WHERE user_id = ?';
        try {
            const [result] = await pool.execute(query, [apiToken, userId]);
            logger.info('API token saved', { userId });
            return result;
        } catch (error) {
            logger.error('Failed to save API token:', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    static async getApiToken(userId) {
        const query = 'SELECT api_token FROM users WHERE user_id = ?';
        try {
            const [rows] = await pool.execute(query, [userId]);
            if (rows.length > 0) {
                return rows[0].api_token;
            }
            return null;
        } catch (error) {
            logger.error('Failed to get API token:', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    static async deleteApiToken(userId) {
        const query = 'UPDATE users SET api_token = NULL WHERE user_id = ?';
        try {
            const [result] = await pool.execute(query, [userId]);
            logger.info('API token deleted', { userId });
            return result;
        } catch (error) {
            logger.error('Failed to delete API token:', {
                error: error.message,
                userId
            });
            throw error;
        }
    }
}