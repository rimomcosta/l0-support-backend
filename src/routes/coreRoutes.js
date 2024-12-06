import express from 'express';
import * as auth from '../api/core/auth.js';
import * as health from '../api/core/health.js';

const router = express.Router();

// Auth routes
router.get('/auth/login', auth.login);
router.get('/callback', auth.callback);
router.get('/auth/user', auth.getUser);
router.post('/auth/logout', auth.logout);

// Health routes
router.get('/health', health.checkHealth);

export default router;