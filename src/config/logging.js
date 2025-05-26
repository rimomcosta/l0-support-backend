// src/config/logging.js

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
    production: 'error',
    development: 'debug',
    test: 'warn'
};

// Get appropriate log level based on environment
export function getLogLevel() {
    return LOG_LEVELS[process.env.NODE_ENV] || 'info';
} 