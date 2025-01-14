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
router.post('/auth/api-token', requireAuth, apiToken.saveApiToken);
router.get('/auth/api-token', requireAuth, apiToken.getApiToken);

// Route for decrypting and verifying the token
router.post('/auth/verify-api-token', requireAuth, apiToken.decryptAndVerifyApiToken);

export default router;