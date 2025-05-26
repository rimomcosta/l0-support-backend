import winston from 'winston';
import { sanitizeLogData, getLogLevel } from '../config/logging.js';

// Custom format that sanitizes sensitive data
const sanitizeFormat = winston.format((info) => {
    // Sanitize the entire info object
    return sanitizeLogData(info);
});

export const logger = winston.createLogger({
    level: getLogLevel(),
    format: winston.format.combine(
        sanitizeFormat(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, userId, sessionId, ...metadata }) => {
            let msg = `${timestamp} [${level}]`;
            if (userId) msg += ` [User: ${userId}]`;
            if (sessionId) msg += ` [Session: ${sessionId}]`;
            msg += `: ${message}`;
            
            // Only log metadata in development
            if (process.env.NODE_ENV === 'development' && Object.keys(metadata).length > 0) {
                msg += ` ${JSON.stringify(metadata)}`;
            }
            
            return msg;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        // Only log to files in production
        ...(process.env.NODE_ENV === 'production' ? [
            new winston.transports.File({ 
                filename: 'error.log', 
                level: 'error',
                maxsize: 10485760, // 10MB
                maxFiles: 5,
                tailable: true
            }),
            new winston.transports.File({ 
                filename: 'combined.log',
                maxsize: 10485760, // 10MB
                maxFiles: 5,
                tailable: true
            })
        ] : [])
    ]
});