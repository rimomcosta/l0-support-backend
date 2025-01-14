// src/config/initDatabase.js
import { pool } from './database.js';
import { logger } from '../services/logger.js';

const tables = {
    commands: `
        CREATE TABLE IF NOT EXISTS commands (
            id INT PRIMARY KEY AUTO_INCREMENT,
            title VARCHAR(255) NOT NULL,
            command TEXT NOT NULL,
            description TEXT, 
            service_type ENUM('ssh', 'sql', 'redis', 'opensearch', 'magento_cloud', 'bash', 'rabbitmq') NOT NULL,
            execute_on_all_nodes BOOLEAN DEFAULT FALSE,
            auto_run BOOLEAN DEFAULT TRUE,
            component_code TEXT,
            layout VARCHAR(255) DEFAULT NULL,
            locked BOOLEAN DEFAULT FALSE,
            reviewed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_service_type (service_type),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    user: `
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
            UNIQUE KEY (chat_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    chat_messages: `
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            chat_id VARCHAR(255) NOT NULL,
            role ENUM('user','assistant','system') NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chat_id (chat_id),
            CONSTRAINT fk_chat_id FOREIGN KEY (chat_id) REFERENCES chat_sessions(chat_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
};

export async function initializeTables() {
    try {
        for (const [tableName, query] of Object.entries(tables)) {
            await pool.execute(query);
            logger.info(`Table ${tableName} initialized successfully or already exists`);
        }
    } catch (error) {
        logger.error('Failed to initialize database tables:', error);
        throw error;
    }
}