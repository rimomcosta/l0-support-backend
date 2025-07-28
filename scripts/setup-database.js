#!/usr/bin/env node

/**
 * Database Setup Script for L0 Support
 * 
 * This script initializes the database with the initial seed data.
 * It creates the database if it doesn't exist and populates it with
 * essential data (commands and mock user).
 * 
 * Usage: npm run setup:db
 */

import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbName = 'l0support';
const seedFilePath = path.join(__dirname, '..', 'database', 'seed.sql');

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
        console.log(`✅ Database ${dbName} created successfully or already exists`);

        // Close the initial connection
        await connection.end();
    } catch (error) {
        console.error('❌ Failed to create database:', error.message);
        throw error;
    }
}

async function populateDatabase() {
    try {
        // Check if seed file exists
        try {
            await fs.access(seedFilePath);
        } catch (error) {
            throw new Error(`Seed file not found: ${seedFilePath}`);
        }

        let seedFile = await fs.readFile(seedFilePath, 'utf8');

        // Use child_process to execute the seed file with mysql client
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const passwordPart = process.env.DB_PASSWORD ? `-p${process.env.DB_PASSWORD}` : '';
        
        // Execute the seed file (adds mock user)
        const seedCommand = `mysql -u${process.env.DB_USER || 'root'} -h${process.env.DB_HOST || '127.0.0.1'} ${passwordPart} -D${dbName} < "${seedFilePath}"`;
        
        try {
            await execAsync(seedCommand);
            console.log('✅ Successfully executed seed file');
        } catch (err) {
            console.error('❌ Error executing seed file:', err.message);
            throw err;
        }

        // Execute the commands seed file (adds all 47 commands)
        const commandsSeedPath = path.join(__dirname, '..', 'database', 'commands_seed.sql');
        const commandsCommand = `mysql -u${process.env.DB_USER || 'root'} -h${process.env.DB_HOST || '127.0.0.1'} ${passwordPart} -D${dbName} < "${commandsSeedPath}"`;
        
        try {
            await execAsync(commandsCommand);
            console.log('✅ Successfully imported all commands');
        } catch (err) {
            console.error('❌ Error importing commands:', err.message);
            throw err;
        }

        console.log('✅ Database populated successfully with all data');
    } catch (error) {
        console.error('❌ Failed to populate database:', error.message);
        throw error;
    }
}

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
        const [commandsResult] = await dbPool.query('SELECT COUNT(*) as count FROM commands');
        console.log(`✅ Commands table: ${commandsResult[0].count} records`);

        // Check users table
        const [usersResult] = await dbPool.query('SELECT COUNT(*) as count FROM users');
        console.log(`✅ Users table: ${usersResult[0].count} records`);

        // Check mock user exists
        const [mockUserResult] = await dbPool.query('SELECT username, email FROM users WHERE user_id = ?', ['dev-admin-user']);
        if (mockUserResult.length > 0) {
            console.log(`✅ Mock user found: ${mockUserResult[0].username} (${mockUserResult[0].email})`);
        } else {
            console.log('⚠️  Mock user not found');
        }

        await dbPool.end();
    } catch (error) {
        console.error('❌ Failed to verify setup:', error.message);
        throw error;
    }
}

async function main() {
    console.log('🚀 Starting L0 Support database setup...\n');

    try {
        await createDatabase();
        await populateDatabase();
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