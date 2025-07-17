#!/usr/bin/env node

// scripts/updateMockUser.js
// Utility script to update mock user configuration

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mockUserConfigPath = path.join(__dirname, '../src/config/mockUser.js');

async function updateMockUserConfig(updates) {
    try {
        // Read the current config file
        let content = await fs.readFile(mockUserConfigPath, 'utf8');
        
        // Apply updates to the MOCK_USER_CONFIG object
        for (const [key, value] of Object.entries(updates)) {
            const regex = new RegExp(`(${key}:\\s*)(['"]?[^'",\\s]+['"]?|true|false|\\[.*?\\]|null)`, 'g');
            
            if (typeof value === 'string') {
                content = content.replace(regex, `$1'${value}'`);
            } else if (typeof value === 'boolean') {
                content = content.replace(regex, `$1${value}`);
            } else if (Array.isArray(value)) {
                content = content.replace(regex, `$1[${value.map(v => `'${v}'`).join(', ')}]`);
            } else if (value === null) {
                content = content.replace(regex, `$1null`);
            }
        }
        
        // Write the updated content back
        await fs.writeFile(mockUserConfigPath, content, 'utf8');
        
        // Calculate new config hash
        const { getConfigHash } = await import('../src/config/mockUser.js');
        const newHash = getConfigHash();
        
        console.log('✅ Mock user configuration updated successfully!');
        console.log('📝 Changes made:');
        for (const [key, value] of Object.entries(updates)) {
            console.log(`   ${key}: ${JSON.stringify(value)}`);
        }
        console.log(`🔐 New configuration hash: ${newHash}`);
        console.log('\n🔄 Session will be automatically refreshed on next request (no restart needed)!');
        
    } catch (error) {
        console.error('❌ Error updating mock user configuration:', error.message);
        process.exit(1);
    }
}

// Example usage
if (process.argv.length < 3) {
    console.log('Usage: node scripts/updateMockUser.js <key>=<value> [<key>=<value> ...]');
    console.log('\nExamples:');
    console.log('  node scripts/updateMockUser.js name="New Admin Name"');
    console.log('  node scripts/updateMockUser.js email="newadmin@example.com" isAdmin=false');
    console.log('  node scripts/updateMockUser.js groups="admin,user,developer"');
    console.log('\nAvailable keys: id, email, name, role, isAdmin, isUser, groups, username, salt, api_token');
    process.exit(1);
}

const updates = {};
for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const [key, value] = arg.split('=');
    
    if (!key || !value) {
        console.error(`❌ Invalid argument format: ${arg}`);
        console.error('Use format: key=value');
        process.exit(1);
    }
    
    // Parse value based on type
    let parsedValue = value;
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (value === 'null') parsedValue = null;
    else if (value.startsWith('[') && value.endsWith(']')) {
        parsedValue = value.slice(1, -1).split(',').map(v => v.trim().replace(/['"]/g, ''));
    }
    else if (value.startsWith('"') && value.endsWith('"')) {
        parsedValue = value.slice(1, -1);
    }
    
    updates[key] = parsedValue;
}

updateMockUserConfig(updates); 