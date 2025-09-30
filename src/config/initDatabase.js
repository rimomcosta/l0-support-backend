// src/config/initDatabase.js
import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../services/logger.js';
import { getMockUserInsertSQL } from './mockUser.js';

const dbName = process.env.DB_NAME || 'l0support';

const tables = {
    commands: `
        CREATE TABLE IF NOT EXISTS commands (
            id INT PRIMARY KEY AUTO_INCREMENT,
            title VARCHAR(255) NOT NULL,
            command TEXT NOT NULL,
            description TEXT, 
            service_type ENUM('ssh', 'sql', 'redis', 'opensearch', 'magento_cloud', 'bash', 'rabbitmq') NOT NULL,
            execute_on_all_nodes BOOLEAN DEFAULT FALSE,
            allow_ai BOOLEAN DEFAULT FALSE,
            auto_run BOOLEAN DEFAULT TRUE,
            component_code TEXT,
            locked BOOLEAN DEFAULT FALSE,
            reviewed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_service_type (service_type),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    users: `
        CREATE TABLE IF NOT EXISTS users (
            user_id VARCHAR(255) PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            api_token TEXT UNIQUE,
            salt VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    chat_sessions: `
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            chat_id VARCHAR(255) NOT NULL,
            user_id VARCHAR(255) DEFAULT NULL, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            project_id VARCHAR(255) DEFAULT NULL,
            environment VARCHAR(255) DEFAULT NULL,
            title VARCHAR(500) DEFAULT 'Untitled Chat',
            UNIQUE KEY (chat_id),
            INDEX idx_project_id (project_id),
            INDEX idx_environment (environment),
            INDEX idx_user_project_env (user_id, project_id, environment),
            INDEX idx_chat_title (title)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    chat_messages: `
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            chat_id VARCHAR(255) NOT NULL,
            role ENUM('user','assistant','system','thinking') NOT NULL,
            content LONGTEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chat_id (chat_id),
            INDEX idx_created_at (created_at),
            CONSTRAINT fk_chat_id FOREIGN KEY (chat_id) REFERENCES chat_sessions (chat_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    dashboard_layouts: `
        CREATE TABLE IF NOT EXISTS dashboard_layouts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            layouts LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(layouts)), -- Stores layout, pinned, and collapsed states
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_layout_user (user_id),
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    feedback: `
        CREATE TABLE IF NOT EXISTS feedback (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            chat_id VARCHAR(255) NOT NULL,
            message_id VARCHAR(255) NOT NULL,
            feedback_type ENUM('helpful', 'not_helpful') NOT NULL,
            reasons LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(reasons)), -- Array of selected reasons
            additional_feedback TEXT DEFAULT NULL, -- Free-form feedback text
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_user_message_feedback (user_id, message_id),
            INDEX idx_user_id (user_id),
            INDEX idx_chat_id (chat_id),
            INDEX idx_message_id (message_id),
            INDEX idx_feedback_type (feedback_type),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    user_ai_settings: `
        CREATE TABLE IF NOT EXISTS user_ai_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            ai_model ENUM('reasoning', 'fast') NOT NULL DEFAULT 'fast',
            response_style ENUM('objective', 'balanced', 'creative') NOT NULL DEFAULT 'balanced',
            response_length ENUM('short', 'default', 'long') NOT NULL DEFAULT 'default',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_user_settings (user_id),
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    transaction_analysis: `
        CREATE TABLE IF NOT EXISTS transaction_analysis (
            id INT AUTO_INCREMENT PRIMARY KEY,
            project_id VARCHAR(255) NOT NULL,
            environment VARCHAR(50) NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            analysis_name VARCHAR(255) NOT NULL,
            extra_context TEXT DEFAULT NULL,
            original_payload LONGTEXT NOT NULL,
            analysis_result LONGTEXT NOT NULL,
            status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
            error_message TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL DEFAULT NULL,
            token_count INT DEFAULT 0,
            processing_time_ms INT DEFAULT 0,
            use_ai TINYINT(1) DEFAULT 1 COMMENT 'Whether this analysis should be used in AI chat (1=selected/green sparkles, 0=unselected/red sparkles)',
            INDEX idx_project_env (project_id, environment),
            INDEX idx_user_id (user_id),
            INDEX idx_status (status),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    user_dashboard_layouts: `
        CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            layouts LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(layouts)),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY user_id (user_id),
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
};

async function createDatabase() {
    try {
        // Create a connection without specifying the database
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            multipleStatements: true
        });

        // Create the database if it doesn't exist
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        logger.info(`Database ${dbName} created successfully or already exists`);

        // Close the initial connection
        await connection.end();
    } catch (error) {
        logger.error('Failed to create database:', error);
        throw error;
    }
}


export async function initializeTables() {
    try {
        // Create a connection pool with the database selected
        const dbPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            multipleStatements: true
        });

        // Initialize tables
        for (const [tableName, query] of Object.entries(tables)) {
            try {
                await dbPool.query(query);
                logger.info(`Table ${tableName} initialized successfully or already exists`);
            } catch (error) {
                logger.warn(`Table ${tableName} creation failed (may already exist):`, error.message);
            }
        }

        // Insert mock development user if USE_OKTA=false
        if (process.env.NODE_ENV !== 'production' && process.env.USE_OKTA === 'false') {
            try {
                const mockUserQuery = getMockUserInsertSQL();
                await dbPool.query(mockUserQuery);
                logger.info('Mock development user inserted or already exists');
            } catch (error) {
                logger.warn('Failed to insert mock development user:', error.message);
            }
        }

        await dbPool.end();
    } catch (error) {
        logger.error('Failed to initialize database tables:', error);
        throw error;
    }
}
