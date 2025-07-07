// src/config/database.js
import mysql from 'mysql2/promise';
import { logger } from '../services/logger.js';
import { initializeTables } from './initDatabase.js';

// Initialize the database and tables before creating the pool
async function initializeDatabase() {
  try {
    await initializeTables();
    logger.info('Database tables initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize database tables:', error);
    throw error;
  }
}

// Initialize on module load
initializeDatabase().catch(error => {
  logger.error('Database initialization failed:', error);
  console.error('Database initialization failed:', error);
  process.exit(1);
});

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
