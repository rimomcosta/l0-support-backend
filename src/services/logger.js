import winston from 'winston';
import { sanitizeLogData, getLogLevel, LOG_DIR, LOG_FILES, LOG_ROTATION, getSSHLogLevel, getMagentoLogLevel } from '../config/logging.js';
import fs from 'fs/promises';
import path from 'path';

// Ensure log directory exists
async function ensureLogDirectory() {
    try {
        await fs.mkdir(LOG_DIR, { recursive: true });
    } catch (error) {
        console.error('Failed to create log directory:', error);
    }
}

// Initialize log directory
ensureLogDirectory();

// Common format for all loggers
const commonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp, userId, sessionId, ...metadata }) => {
        let msg = `${timestamp} [${level}]`;
        if (userId) msg += ` [User: ${userId}]`;
        if (sessionId) msg += ` [Session: ${sessionId}]`;
        msg += `: ${message}`;
        
        // Only log metadata in development or when explicitly requested
        if ((process.env.NODE_ENV === 'development' || metadata.forceLog) && Object.keys(metadata).length > 0) {
            // Simple sanitization: remove sensitive fields
            const sanitizedMetadata = { ...metadata };
            const sensitiveFields = ['password', 'apiToken', 'api_token', 'token', 'secret'];
            
            sensitiveFields.forEach(field => {
                if (sanitizedMetadata[field]) {
                    sanitizedMetadata[field] = '[REDACTED]';
                }
            });
            
            msg += ` ${JSON.stringify(sanitizedMetadata)}`;
        }
        
        return msg;
    })
);

// Main logger configuration
export const logger = winston.createLogger({
    level: getLogLevel(),
    format: commonFormat,
    transports: [
        // Console transport
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        // Error log file (all environments)
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.error),
            level: 'error',
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        }),
        // Debug log file (all environments)
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.debug),
            level: 'debug',
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        }),
        // Combined log file (all environments)
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.combined),
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        })
    ]
});

// SSH-specific logger
export const sshLogger = winston.createLogger({
    level: getSSHLogLevel(),
    format: commonFormat,
    transports: [
        // Console transport (only in development)
        ...(process.env.NODE_ENV === 'development' ? [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            })
        ] : []),
        // SSH-specific log file
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.ssh),
            level: 'debug',
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        }),
        // Also log errors to main error log
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.error),
            level: 'error',
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        })
    ]
});

// Magento Cloud-specific logger
export const magentoLogger = winston.createLogger({
    level: getMagentoLogLevel(),
    format: commonFormat,
    transports: [
        // Console transport (only in development)
        ...(process.env.NODE_ENV === 'development' ? [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            })
        ] : []),
        // Magento-specific log file
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.magento),
            level: 'debug',
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        }),
        // Also log errors to main error log
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.error),
            level: 'error',
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        })
    ]
});

// Activity logger (for user actions)
export const activityLogger = winston.createLogger({
    level: 'info',
    format: commonFormat,
    transports: [
        // Console transport (only in development)
        ...(process.env.NODE_ENV === 'development' ? [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            })
        ] : []),
        // Activity log file
        new winston.transports.File({ 
            filename: path.resolve(LOG_FILES.activity),
            level: 'info',
            maxsize: LOG_ROTATION.maxSize,
            maxFiles: LOG_ROTATION.maxFiles,
            tailable: LOG_ROTATION.tailable
        })
    ]
});

// Helper function to log SSH operations with detailed context
export function logSSHOperation(level, message, context = {}) {
    const logData = {
        ...context,
        timestamp: new Date().toISOString(),
        operation: 'SSH',
        forceLog: true // Always log metadata for SSH operations
    };
    
    sshLogger[level](message, logData);
}

// Helper function to log Magento Cloud operations with detailed context
export function logMagentoOperation(level, message, context = {}) {
    const logData = {
        ...context,
        timestamp: new Date().toISOString(),
        operation: 'MAGENTO_CLOUD',
        forceLog: true // Always log metadata for Magento operations
    };
    
    magentoLogger[level](message, logData);
}

// Helper function to log user activity
export function logActivity(message, context = {}) {
    const logData = {
        ...context,
        timestamp: new Date().toISOString(),
        operation: 'USER_ACTIVITY'
    };
    
    activityLogger.info(message, logData);
}

// Export log level functions
export { getSSHLogLevel, getMagentoLogLevel } from '../config/logging.js';