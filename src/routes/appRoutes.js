import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as environment from '../api/app/environment.js';
import * as nodes from '../api/app/nodes.js';
import * as sshCommands from '../api/app/sshCommands.js';
import * as sqlCommands from '../api/app/sqlCommands.js';
import * as redisCommands from '../api/app/redisCommands.js';
import * as openSearchCommands from '../api/app/openSearchCommands.js';

const router = express.Router();

router.get('/:projectId/environments', requireAuth, environment.getEnvironments);
router.get('/:projectId/:environment/nodes', requireAuth, nodes.getNodes);
router.post('/:projectId/:environment/sshcommand', requireAuth, sshCommands.runCommands);
router.post('/:projectId/:environment/sqlquery', requireAuth, sqlCommands.runQueries);
router.post('/:projectId/:environment/redisquery', requireAuth, redisCommands.runQueries);
router.post('/:projectId/:environment/searchquery', requireAuth, openSearchCommands.runQueries);


export default router;