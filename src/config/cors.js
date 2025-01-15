import { logger } from '../services/logger.js';
export const corsConfig = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',          // Development
            process.env.CLIENT_ORIGIN,       // Defined in .env
            process.env.REACT_APP_API_URL,   // Defined in .env
            'https://l0support.ngrok.io',    // Ngrok endpoint
            'http://10.122.12.162:3000'      // Server's local address
        ].filter(Boolean);

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn(`Origin ${origin} not allowed by CORS`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'ngrok-skip-browser-warning',
        'Origin',
        'Accept',
        'Cookie',
        'x-api-token-password'
    ],
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204
};
