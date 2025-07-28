// src/config/logging.js
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fields that should never be logged
export const SENSITIVE_FIELDS = [
    'password',
    'apiToken',
    'api_token',
    'decryptedApiToken',
    'access_token',
    'id_token',
    'refresh_token',
    'token',
    'tokens',
    'secret',
    'salt',
    'codeVerifier',
    'codeChallenge',
    'state',
    'nonce',
    'cookie',
    'cookies',
    'authorization',
    'auth',
    'session',
    'sessionID',
    'client_secret',
    'encryption_key',
    'private_key',
    'ssh_key',
    'credentials'
];

// Sanitize objects to remove sensitive data before logging
export function sanitizeLogData(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }

    const sanitized = Array.isArray(data) ? [] : {};

    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const lowerKey = key.toLowerCase();
            
            // Check if the key contains sensitive field names
            const isSensitive = SENSITIVE_FIELDS.some(field => 
                lowerKey.includes(field.toLowerCase())
            );

            if (isSensitive) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof data[key] === 'object' && data[key] !== null) {
                // Recursively sanitize nested objects
                sanitized[key] = sanitizeLogData(data[key]);
            } else {
                sanitized[key] = data[key];
            }
        }
    }

    return sanitized;
}

// Log levels configuration
export const LOG_LEVELS = {
    production: 'info',
    development: 'debug',
    test: 'warn'
};

// Get appropriate log level based on environment
export function getLogLevel() {
    return LOG_LEVELS[process.env.NODE_ENV] || 'info';
}

// Log directory configuration
export const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

// Log file paths
export const LOG_FILES = {
    error: path.join(LOG_DIR, 'error.log'),
    debug: path.join(LOG_DIR, 'debug.log'),
    combined: path.join(LOG_DIR, 'combined.log'),
    activity: path.join(LOG_DIR, 'activity.log'),
    ssh: path.join(LOG_DIR, 'ssh.log'),
    magento: path.join(LOG_DIR, 'magento.log')
};

// Log rotation configuration
export const LOG_ROTATION = {
    maxSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
};

// Special logging for SSH operations
export const SSH_LOG_LEVELS = {
    production: 'info',
    development: 'debug',
    test: 'debug'
};

export function getSSHLogLevel() {
    return SSH_LOG_LEVELS[process.env.NODE_ENV] || 'debug';
}

// Special logging for Magento Cloud operations
export const MAGENTO_LOG_LEVELS = {
    production: 'info',
    development: 'debug',
    test: 'debug'
};

export function getMagentoLogLevel() {
    return MAGENTO_LOG_LEVELS[process.env.NODE_ENV] || 'debug';
} 