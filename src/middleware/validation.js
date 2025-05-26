import { logger } from '../services/logger.js';

export function validateApiToken(req, res, next) {
    if (!req.session?.decryptedApiToken) {
        logger.warn('API token validation failed', {
            userId: req.session?.user?.id,
            path: req.path,
            hasSession: !!req.session,
            hasUser: !!req.session?.user,
            hasToken: !!req.session?.decryptedApiToken
        });
        return res.status(401).json({ 
            error: 'API token not found or not decrypted. Please provide your decryption password.',
            requiresDecryption: true 
        });
    }
    next();
}

export function validateRequestBody(requiredFields) {
    return (req, res, next) => {
        const missingFields = requiredFields.filter(field => !req.body[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }
        
        next();
    };
}

export function sanitizeInput(req, res, next) {
    // Basic input sanitization
    if (req.body) {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                req.body[key] = req.body[key].trim();
            }
        });
    }
    next();
} 