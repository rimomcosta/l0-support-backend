import { logger } from '../services/logger.js';

export const corsConfig = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',          // Development
            'http://localhost:3001',          // Alternative development port
            process.env.CLIENT_ORIGIN,       // Defined in .env
            process.env.REACT_APP_API_URL,   // Defined in .env
            'https://l0support.ngrok.io',    // Ngrok endpoint
            'http://10.122.12.162:3000'      // Server's local address
        ].filter(Boolean);

        // Allow any ngrok subdomain to handle dynamic ngrok URLs
        const isNgrokOrigin = origin && origin.includes('.ngrok.io');
        const isLocalhostOrigin = origin && (origin.includes('localhost') || origin.includes('127.0.0.1'));
        
        if (!origin || allowedOrigins.includes(origin) || isNgrokOrigin || isLocalhostOrigin) {
            callback(null, true);
        } else {
            logger.warn(`Origin ${origin} not allowed by CORS`, {
                origin,
                allowedOrigins,
                isNgrokOrigin,
                isLocalhostOrigin
            });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'ngrok-skip-browser-warning',
        'Origin',
        'Accept',
        'Cookie',
        'x-api-token-password',
        'X-Requested-With',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers'
    ],
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400 // Cache preflight response for 24 hours
};
