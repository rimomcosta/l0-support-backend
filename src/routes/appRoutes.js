import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as environment from '../api/app/environment.js';
import * as nodes from '../api/app/nodes.js';

const router = express.Router();

router.get('/environments/:projectId', requireAuth, environment.getEnvironments);
router.get('/nodes/:projectId/:environment', requireAuth, nodes.getNodes);

export default router;