// src/config/database.js
import mysql from 'mysql2/promise';
import { logger } from '../services/logger.js';
import { initializeTables } from './initDatabase.js';

// Initialize the database and tables before creating the pool
await initializeTables();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'l0support',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test the connection
pool.getConnection()
    .then(connection => {
        logger.info('Database connection established successfully');
        connection.release();
    })
    .catch(error => {
        logger.error('Failed to connect to database:', error);
    });

export { pool };
