import { logger } from '../services/logger.js';

export function requireAuth(req, res, next) {
    if (!req.session.user) {
        logger.debug('Unauthorized access attempt:', {
            path: req.path,
            method: req.method,
            sessionID: req.sessionID
        });
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

export function sessionDebug(req, res, next) {
    logger.debug('Session Debug:', {
        sessionID: req.sessionID,
        hasSession: !!req.session,
        cookies: req.cookies,
        url: req.url
    });
    next();
}