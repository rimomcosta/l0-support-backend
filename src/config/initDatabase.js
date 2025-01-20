// src/config/initDatabase.js
import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../services/logger.js';

const dbName = 'l0support';

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
            layout VARCHAR(255) DEFAULT NULL,
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

async function populateDatabase(seedFilePath) {
    try {
        let seedFile = await fs.readFile(seedFilePath, 'utf8');

        // Remove comments
        seedFile = seedFile.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '');

        // Split into individual queries and filter out empty ones
        const queries = seedFile
            .split(';')
            .map(query => query.trim())
            .filter(query => query.length > 0);

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

        // Execute each query
        for (const query of queries) {
            try {
                await dbPool.query(query);
                logger.info('Successfully executed query');
            } catch (err) {
                logger.error('Error executing query:', { query, error: err });
                throw err;
            }
        }

        logger.info('Database populated successfully from commandsSeed.sql');
        await dbPool.end();
    } catch (error) {
        logger.error('Failed to populate database:', error);
        throw error;
    }
}

export async function initializeTables() {
    try {
        await createDatabase();

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
            await dbPool.query(query);
            logger.info(`Table ${tableName} initialized successfully or already exists`);
        }

        await dbPool.end();
    } catch (error) {
        logger.error('Failed to initialize database tables:', error);
        throw error;
    }
}