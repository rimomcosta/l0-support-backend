// src/routes/coreRoutes.js
import express from 'express';
import * as auth from '../api/core/auth.js';
import * as health from '../api/core/health.js';
import * as apiToken from '../api/core/apiToken.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Auth routes
router.get('/auth/login', auth.login);
router.get('/auth/callback', auth.callback);
router.get('/auth/user', auth.getUser);
router.post('/auth/logout', auth.logout);

// Health routes
router.get('/health', health.checkHealth);

// API Token routes
router.post('/auth/api-token', requireAuth, apiToken.encryptAndSaveApiToken);
router.get('/auth/api-token', requireAuth, apiToken.getApiToken);
router.post('/auth/api-token-decrypt', requireAuth, apiToken.decryptApiToken);
router.delete('/auth/api-token', requireAuth, apiToken.revokeApiToken);

// Handle OPTIONS for API token routes
router.options('/auth/api-token', (req, res) => {
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.sendStatus(204);
});

export default router;