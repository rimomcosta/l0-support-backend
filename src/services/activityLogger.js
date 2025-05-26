import winston from 'winston';
import { sanitizeLogData, SENSITIVE_FIELDS } from '../config/logging.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Extended list of sensitive patterns for activity logs
const ACTIVITY_SENSITIVE_PATTERNS = [
    ...SENSITIVE_FIELDS,
    'stdout', // Command outputs might contain sensitive data
    'stderr',
    'output',
    'result',
    'response',
    'data'
];

// Custom sanitizer for activity logs - more aggressive
function sanitizeActivityData(data) {
    if (!data || typeof data !== 'object') {
        // For strings, check if they might contain sensitive data
        if (typeof data === 'string') {
            // Check for common patterns like API tokens, passwords in strings
            const sensitivePatterns = [
                /api[_-]?token[:\s]*[^\s,}]+/gi,
                /password[:\s]*[^\s,}]+/gi,
                /token[:\s]*[^\s,}]+/gi,
                /secret[:\s]*[^\s,}]+/gi,
                /key[:\s]*[^\s,}]+/gi,
                /bearer\s+[^\s]+/gi,
                /authorization[:\s]*[^\s,}]+/gi
            ];
            
            let sanitized = data;
            sensitivePatterns.forEach(pattern => {
                sanitized = sanitized.replace(pattern, '[REDACTED]');
            });
            return sanitized;
        }
        return data;
    }

    const sanitized = Array.isArray(data) ? [] : {};

    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const lowerKey = key.toLowerCase();
            
            // Check if the key contains sensitive field names
            const isSensitive = ACTIVITY_SENSITIVE_PATTERNS.some(field => 
                lowerKey.includes(field.toLowerCase())
            );

            if (isSensitive) {
                // For activity logs, provide minimal info about what was redacted
                if (typeof data[key] === 'string' && data[key].length > 0) {
                    sanitized[key] = `[REDACTED-${data[key].length} chars]`;
                } else if (Array.isArray(data[key])) {
                    sanitized[key] = `[REDACTED-Array(${data[key].length})]`;
                } else if (typeof data[key] === 'object' && data[key] !== null) {
                    sanitized[key] = '[REDACTED-Object]';
                } else {
                    sanitized[key] = '[REDACTED]';
                }
            } else if (typeof data[key] === 'object' && data[key] !== null) {
                // Recursively sanitize nested objects
                sanitized[key] = sanitizeActivityData(data[key]);
            } else if (typeof data[key] === 'string') {
                // Sanitize string values that might contain sensitive data
                sanitized[key] = sanitizeActivityData(data[key]);
            } else {
                sanitized[key] = data[key];
            }
        }
    }

    return sanitized;
}

// Custom format for activity logs
const activityFormat = winston.format((info) => {
    // Create a copy of info to avoid mutating the original
    const sanitized = { ...info };
    
    // Sanitize only the metadata, not the entire info object
    Object.keys(sanitized).forEach(key => {
        if (key !== 'level' && key !== 'message' && key !== 'timestamp') {
            sanitized[key] = sanitizeActivityData(sanitized[key]);
        }
    });
    
    return sanitized;
});

// Create activity logger
export const activityLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        activityFormat(),
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // Always log activities to file
        new winston.transports.File({ 
            filename: path.join(__dirname, '../../logs/activity.log'),
            maxsize: 52428800, // 50MB
            maxFiles: 10,
            tailable: true
        }),
        // In development, also log to console
        ...(process.env.NODE_ENV === 'development' ? [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
                        const meta = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
                        return `${timestamp} [${level}] ${message} ${meta}`;
                    })
                )
            })
        ] : [])
    ]
});

// Helper functions for common activity types
export const logActivity = {
    // User authentication activities
    auth: {
        login: (userId, email, role) => {
            activityLogger.info('User login', {
                activity: 'auth.login',
                userId,
                email,
                role,
                timestamp: new Date().toISOString()
            });
        },
        logout: (userId, email) => {
            activityLogger.info('User logout', {
                activity: 'auth.logout',
                userId,
                email,
                timestamp: new Date().toISOString()
            });
        },
        sessionExpired: (userId, email) => {
            activityLogger.info('Session expired', {
                activity: 'auth.sessionExpired',
                userId,
                email,
                timestamp: new Date().toISOString()
            });
        }
    },

    // API token activities
    apiToken: {
        saved: (userId, email) => {
            activityLogger.info('API token saved', {
                activity: 'apiToken.saved',
                userId,
                email,
                timestamp: new Date().toISOString()
            });
        },
        decrypted: (userId, email) => {
            activityLogger.info('API token decrypted', {
                activity: 'apiToken.decrypted',
                userId,
                email,
                timestamp: new Date().toISOString()
            });
        },
        revoked: (userId, email) => {
            activityLogger.info('API token revoked', {
                activity: 'apiToken.revoked',
                userId,
                email,
                timestamp: new Date().toISOString()
            });
        }
    },

    // Command execution activities
    command: {
        executed: (userId, email, commandType, projectId, environment, commandId) => {
            activityLogger.info('Command executed', {
                activity: 'command.executed',
                userId,
                email,
                commandType,
                projectId,
                environment,
                commandId,
                timestamp: new Date().toISOString()
            });
        },
        failed: (userId, email, commandType, projectId, environment, error) => {
            activityLogger.error('Command execution failed', {
                activity: 'command.failed',
                userId,
                email,
                commandType,
                projectId,
                environment,
                error: error.message || error,
                timestamp: new Date().toISOString()
            });
        }
    },

    // Tunnel activities
    tunnel: {
        opened: (userId, email, projectId, environment) => {
            activityLogger.info('Tunnel opened', {
                activity: 'tunnel.opened',
                userId,
                email,
                projectId,
                environment,
                timestamp: new Date().toISOString()
            });
        },
        closed: (userId, email, projectId, environment) => {
            activityLogger.info('Tunnel closed', {
                activity: 'tunnel.closed',
                userId,
                email,
                projectId,
                environment,
                timestamp: new Date().toISOString()
            });
        }
    },

    // WebSocket activities
    websocket: {
        connected: (userId, email, clientId) => {
            activityLogger.info('WebSocket connected', {
                activity: 'websocket.connected',
                userId,
                email,
                clientId,
                timestamp: new Date().toISOString()
            });
        },
        disconnected: (userId, email, clientId) => {
            activityLogger.info('WebSocket disconnected', {
                activity: 'websocket.disconnected',
                userId,
                email,
                clientId,
                timestamp: new Date().toISOString()
            });
        }
    },

    // Chat/AI activities
    chat: {
        created: (userId, email, chatId) => {
            activityLogger.info('Chat session created', {
                activity: 'chat.created',
                userId,
                email,
                chatId,
                timestamp: new Date().toISOString()
            });
        },
        message: (userId, email, chatId, messageLength) => {
            activityLogger.info('Chat message sent', {
                activity: 'chat.message',
                userId,
                email,
                chatId,
                messageLength,
                timestamp: new Date().toISOString()
            });
        }
    },

    // Generic activity logging
    custom: (message, metadata = {}) => {
        activityLogger.info(message, {
            activity: 'custom',
            ...sanitizeActivityData(metadata),
            timestamp: new Date().toISOString()
        });
    }
};

// Export for use in other modules
export default activityLogger; 