// src/config/mockUser.js
// Single source of truth for mock user configuration

export const MOCK_USER_CONFIG = {
    // User identification
    id: 'dev-admin-user',
    email: 'dev-admin@example.com',
    name: 'Development Admin',
    
    // Authentication & permissions
    role: 'admin',
    isAdmin: true,
    isUser: true,
    groups: ['GRP-L0SUPPORT-ADMIN', 'GRP-L0SUPPORT-USER'],
    
    // Database fields
    username: 'Development Admin',
    salt: 'dev-salt-placeholder',
    api_token: null
};

// Configuration hash that changes when config is modified
// This helps detect when sessions need to be refreshed
export function getConfigHash() {
    const configString = JSON.stringify({
        id: MOCK_USER_CONFIG.id,
        email: MOCK_USER_CONFIG.email,
        name: MOCK_USER_CONFIG.name,
        role: MOCK_USER_CONFIG.role,
        isAdmin: true,
        isUser: MOCK_USER_CONFIG.isUser,
        groups: MOCK_USER_CONFIG.groups
    });
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < configString.length; i++) {
        const char = configString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36); // Convert to base36 for shorter string
}

// Helper function to get mock user for session
export function getMockUserForSession() {
    return {
        id: MOCK_USER_CONFIG.id,
        email: MOCK_USER_CONFIG.email,
        name: MOCK_USER_CONFIG.name,
        role: MOCK_USER_CONFIG.role,
        isAdmin: true,
        isUser: MOCK_USER_CONFIG.isUser,
        groups: MOCK_USER_CONFIG.groups,
        configHash: getConfigHash() // Include hash in session
    };
}

// Helper function to get mock user for database insertion
export function getMockUserForDatabase() {
    return {
        user_id: MOCK_USER_CONFIG.id,
        username: MOCK_USER_CONFIG.username,
        email: MOCK_USER_CONFIG.email,
        api_token: MOCK_USER_CONFIG.api_token,
        salt: MOCK_USER_CONFIG.salt
    };
}

// Helper function to generate database insertion SQL
export function getMockUserInsertSQL() {
    return `
        INSERT IGNORE INTO users (
            user_id,
            username,
            email,
            api_token,
            salt
        ) VALUES (
            '${MOCK_USER_CONFIG.id}',
            '${MOCK_USER_CONFIG.username}',
            '${MOCK_USER_CONFIG.email}',
            ${MOCK_USER_CONFIG.api_token === null ? 'NULL' : `'${MOCK_USER_CONFIG.api_token}'`},
            '${MOCK_USER_CONFIG.salt}'
        )
    `;
} 