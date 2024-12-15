import winston from 'winston';

export const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, userId, sessionId, ...metadata }) => {
            let msg = `${timestamp} [${level}]`;
            if (userId) msg += ` [User: ${userId}]`;
            if (sessionId) msg += ` [Session: ${sessionId}]`;
            msg += `: ${message}`;
            if (Object.keys(metadata).length > 0) msg += ` ${JSON.stringify(metadata)}`;
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
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'debug.log', level: 'debug' })
    ]
});