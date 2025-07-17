// src/middleware/auth.js
import { logger } from '../services/logger.js';

export function requireAuth(req, res, next) {
    if (req.session?.user) {
        next();
    } else {
        res.status(401).send('Unauthorized: You must be logged in to access this resource.');
    }
}

export function requireAdmin(req, res, next) {
    if (req.session?.user?.isAdmin) {
        next();
    } else {
        res.status(403).send('Forbidden: You do not have administrative privileges to access this resource.');
    }
}

export function sessionDebug(req, res, next) {
    console.log('=== SESSION DEBUG ===', {
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        userId: req.session?.user?.id,
        email: req.session?.user?.email,
        name: req.session?.user?.name,
        isAdmin: req.session?.user?.isAdmin,
        groups: req.session?.user?.groups,
    });
    next();
}