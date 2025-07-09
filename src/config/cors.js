import { logger } from '../services/logger.js';

export const corsConfig = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            process.env.CLIENT_ORIGIN,       // Production/staging domain from .env
            process.env.REACT_APP_API_URL,   // API domain from .env
        ].filter(Boolean);

        // Development-only origins
        if (process.env.NODE_ENV !== 'production') {
            allowedOrigins.push(
                'http://localhost:3000',          // Development
                'http://localhost:3001',          // Alternative development port
                'https://l0support.ngrok.io',    // Ngrok endpoint
                'http://10.122.12.162:3000'      // Server's local address
            );
        }

        // Development-only ngrok and localhost handling
        let isNgrokOrigin = false;
        let isLocalhostOrigin = false;
        
        if (process.env.NODE_ENV !== 'production') {
            isNgrokOrigin = origin && origin.includes('.ngrok.io');
            isLocalhostOrigin = origin && (origin.includes('localhost') || origin.includes('127.0.0.1'));
        }
        
        if (!origin || allowedOrigins.includes(origin) || isNgrokOrigin || isLocalhostOrigin) {
            callback(null, true);
        } else {
            logger.warn(`Origin ${origin} not allowed by CORS`, {
                origin,
                allowedOrigins,
                isNgrokOrigin,
                isLocalhostOrigin,
                environment: process.env.NODE_ENV
            });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Origin',
        'Accept',
        'Cookie',
        'x-api-token-password',
        'X-Requested-With',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers'
    ].concat(
        // Add ngrok-specific headers only in development
        process.env.NODE_ENV !== 'production' ? ['ngrok-skip-browser-warning'] : []
    ),
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400 // Cache preflight response for 24 hours
};
