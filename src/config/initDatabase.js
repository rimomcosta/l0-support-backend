// src/config/initDatabase.js
import { pool } from './database.js';
import { logger } from '../services/logger.js';

const tables = {
    commands: `
        CREATE TABLE IF NOT EXISTS commands (
            id INT PRIMARY KEY AUTO_INCREMENT,
            title VARCHAR(255) NOT NULL,
            command JSON NOT NULL,
            service_type ENUM('ssh', 'opensearch', 'redis', 'sql', 'magento_cloud') NOT NULL,
            execute_on_all_nodes BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `
};

export async function initializeTables() {
    try {
        // Drop existing table if it exists
        await pool.execute('DROP TABLE IF EXISTS commands');
        logger.info('Dropped existing commands table');

        // Create table
        for (const [tableName, query] of Object.entries(tables)) {
            await pool.execute(query);
            logger.info(`Table ${tableName} initialized successfully`);
        }
    } catch (error) {
        logger.error('Failed to initialize database tables:', error);
        throw error;
    }
}