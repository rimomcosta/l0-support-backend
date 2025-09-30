#!/usr/bin/env node

/**
 * Database Setup Script for L0 Support
 * 
 * This script provides a seamless database setup experience:
 * - Creates database and tables if they don't exist
 * - Populates with fresh data only if database is empty
 * - Uses safe dump file to avoid injection issues
 * - Preserves existing user data
 * 
 * Usage: npm run setup:db
 */

import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeTables } from '../src/config/initDatabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbName = process.env.DB_NAME || 'l0support';
const hrtDbFilePath = path.join(__dirname, '..', 'database', 'HRT_DB.sql');

/**
 * Check if database exists and has data
 */
async function checkDatabaseStatus() {
    try {
        // Create connection without specifying database
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            multipleStatements: true
        });

        // Check if database exists
        const [databases] = await connection.query('SHOW DATABASES LIKE ?', [dbName]);
        const dbExists = databases.length > 0;

        let hasData = false;
        if (dbExists) {
            // Check if database has any tables with data
            await connection.query(`USE \`${dbName}\``);
            const [tables] = await connection.query('SHOW TABLES');
            
            if (tables.length > 0) {
                // Check if any table has data
                for (const table of tables) {
                    const tableName = Object.values(table)[0];
                    const [count] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
                    if (count[0].count > 0) {
                        hasData = true;
                        break;
                    }
                }
            }
        }

        await connection.end();
        
        return { dbExists, hasData };
    } catch (error) {
        console.error('❌ Failed to check database status:', error.message);
        throw error;
    }
}

/**
 * Create database if it doesn't exist
 */
async function createDatabase() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            multipleStatements: true
        });

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        console.log(`✅ Database ${dbName} created successfully or already exists`);

        await connection.end();
    } catch (error) {
        console.error('❌ Failed to create database:', error.message);
        throw error;
    }
}

/**
 * Populate database with HRT_DB.sql file
 */
async function populateDatabase() {
    try {
        // Check if HRT_DB.sql file exists
        try {
            await fs.access(hrtDbFilePath);
        } catch (error) {
            throw new Error(`HRT_DB.sql file not found: ${hrtDbFilePath}`);
        }

        // Use child_process to execute the HRT_DB.sql file with mysql client
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const passwordPart = process.env.DB_PASSWORD ? `-p${process.env.DB_PASSWORD}` : '';
        
        // Read HRT_DB.sql content and replace database name
        let hrtContent = await fs.readFile(hrtDbFilePath, 'utf8');
        
        // Replace the hardcoded database name with the configured one
        hrtContent = hrtContent.replace(/CREATE DATABASE\s+IF NOT EXISTS\s+`[^`]+`/g, `CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
        hrtContent = hrtContent.replace(/USE\s+`[^`]+`/g, `USE \`${dbName}\``);
        
        // Write modified content to temporary file
        const tempFilePath = path.join(__dirname, '..', 'database', 'temp_hrt.sql');
        await fs.writeFile(tempFilePath, hrtContent);
        
        // Execute the modified HRT_DB.sql file
        const hrtCommand = `mysql -u${process.env.DB_USER || 'root'} -h${process.env.DB_HOST || '127.0.0.1'} ${passwordPart} < "${tempFilePath}"`;
        
        try {
            await execAsync(hrtCommand);
            console.log('✅ Successfully executed HRT_DB.sql file');
            
            // Clean up temporary file
            await fs.unlink(tempFilePath);
        } catch (err) {
            console.error('❌ Error executing HRT_DB.sql file:', err.message);
            // Clean up temporary file even on error
            try {
                await fs.unlink(tempFilePath);
            } catch (cleanupErr) {
                // Ignore cleanup errors
            }
            throw err;
        }

        console.log('✅ Database populated successfully with HRT_DB.sql');
    } catch (error) {
        console.error('❌ Failed to populate database:', error.message);
        throw error;
    }
}

/**
 * Verify setup by checking key tables
 */
async function verifySetup() {
    try {
        const dbPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Check commands table
        try {
            const [commandsResult] = await dbPool.query('SELECT COUNT(*) as count FROM commands');
            console.log(`✅ Commands table: ${commandsResult[0].count} records`);
        } catch (err) {
            console.log('ℹ️  Commands table: Not found or empty');
        }

        // Check users table
        try {
            const [usersResult] = await dbPool.query('SELECT COUNT(*) as count FROM users');
            console.log(`✅ Users table: ${usersResult[0].count} records`);
            
            // Check for mock user
            const [mockUserResult] = await dbPool.query('SELECT username, email FROM users WHERE user_id = ?', ['dev-admin-user']);
            if (mockUserResult.length > 0) {
                console.log(`✅ Mock user found: ${mockUserResult[0].username} (${mockUserResult[0].email})`);
            }
        } catch (err) {
            console.log('ℹ️  Users table: Not found or empty');
        }

        // Check other important tables
        const importantTables = ['chat_sessions', 'user_ai_settings', 'transaction_analysis'];
        for (const tableName of importantTables) {
            try {
                const [result] = await dbPool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
                console.log(`✅ ${tableName} table: ${result[0].count} records`);
            } catch (err) {
                console.log(`ℹ️  ${tableName} table: Not found or empty`);
            }
        }

        await dbPool.end();
    } catch (error) {
        console.error('❌ Failed to verify setup:', error.message);
        throw error;
    }
}

/**
 * Main setup function
 */
async function main() {
    console.log('🚀 Starting L0 Support database setup...\n');

    try {
        // Check current database status
        const { dbExists, hasData } = await checkDatabaseStatus();
        
        if (dbExists && hasData) {
            console.log('ℹ️  Database already exists with data - skipping setup');
            console.log('✅ Database is ready to use');
            return;
        }

        if (!dbExists) {
            console.log('📦 Creating database and populating with HRT_DB.sql...');
            await populateDatabase();
        } else if (!hasData) {
            console.log('📊 Populating database with HRT_DB.sql...');
            await populateDatabase();
        }

        console.log('🔍 Verifying setup...');
        await verifySetup();
        
        console.log('\n🎉 Database setup completed successfully!');
        console.log('\n📋 Next steps:');
        console.log('   1. Start the backend server: npm run dev');
        console.log('   2. Start the frontend: cd ../Frontend && npm start');
        console.log('   3. Login with mock user: dev-admin@example.com');
        
    } catch (error) {
        console.error('\n💥 Database setup failed:', error.message);
        process.exit(1);
    }
}

// Run the setup
main();