// src/services/apiTokenService.js
import { pool } from '../config/database.js';
import { logger } from './logger.js';
import { EncryptionService } from './encryptionService.js';
import { v4 as uuidv4 } from 'uuid';

export class ApiTokenService {
    static async createUser(user) {
        const query = 'INSERT INTO users (user_id, username, email, api_token, salt) VALUES (?, ?, ?, ?, ?)';
        try {
            // Ensure that if api_token is not provided, null is passed to the query
            const encryptedApiToken = user.api_token ? EncryptionService.encrypt(user.api_token, user.salt) : null;

            const [result] = await pool.execute(query, [
                user.user_id,
                user.username,
                user.email,
                encryptedApiToken,
                user.salt
            ]);

            logger.info('User created', { userId: user.user_id });
            return result;
        } catch (error) {
            logger.error('Failed to create user:', {
                error: error.message,
                userId: user.user_id,
                sql: error.sql, // Log the SQL query if available
                sqlState: error.sqlState, // Log the SQL state if available
                sqlMessage: error.sqlMessage // Log the SQL message if available
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

    static async getUserById(userId) {
        const query = 'SELECT * FROM users WHERE user_id = ?';
        try {
            const [rows] = await pool.execute(query, [userId]);
            if (rows.length > 0) {
                return rows[0];
            }
            return null;
        } catch (error) {
            logger.error('Failed to get user by ID:', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    static async saveApiToken(userId, encryptedApiToken) {
        const query = 'UPDATE users SET api_token = ? WHERE user_id = ?';
        try {
            const [result] = await pool.execute(query, [encryptedApiToken, userId]);
            logger.info('API token and salt saved', { userId });
            return result;
        } catch (error) {
            logger.error('Failed to save API token and salt:', {
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
            if (!rows[0].api_token) return null;
            return rows[0].api_token
        } catch (error) {
            logger.error('Failed to get API token and salt:', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    static async deleteApiToken(userId) {
        const query = 'UPDATE users SET api_token = NULL, salt = NULL WHERE user_id = ?';
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