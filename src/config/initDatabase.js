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