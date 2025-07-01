import { logger } from '../services/logger.js';

export const errorHandler = (err, req, res, next) => {
    console.error('=== ERROR HANDLER CAUGHT ERROR ===', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        url: req.url,
        params: req.params
    });
    
    logger.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
};