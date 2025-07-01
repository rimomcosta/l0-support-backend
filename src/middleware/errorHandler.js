import { logger } from '../services/logger.js';

/**
 * Check if an error is an authentication error
 * @param {Error} error - The error to check
 * @returns {boolean} - True if it's an authentication error
 */
export function isAuthenticationError(error) {
    const errorMessage = (error.message || '').toLowerCase();
    const errorCode = error.code || '';
    
    const authErrorPatterns = [
        'invalid api token',
        'authentication',
        'unauthorized',
        '401',
        'access denied',
        'permission denied',
        'api token has been revoked',
        'api token is invalid',
        'authentication required',
        'auth failed',
        'auth_failed'
    ];
    
    return errorCode === 'AUTH_FAILED' || 
           authErrorPatterns.some(pattern => errorMessage.includes(pattern));
}

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

    // Check if it's an authentication error
    if (isAuthenticationError(err)) {
        return res.status(401).json({
            error: 'Authentication failed',
            message: 'Your API token appears to be invalid or revoked. Please update your API token.',
            code: 'TOKEN_INVALID'
        });
    }

    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
};