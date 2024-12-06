import express from 'express';
import * as environment from '../api/app/environment.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Environment routes
router.get('/environments/:projectId', requireAuth, environment.getEnvironments);

export default router;