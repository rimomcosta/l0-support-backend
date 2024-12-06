import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as environment from '../api/app/environment.js';
import * as nodes from '../api/app/nodes.js';
import * as sshCommands from '../api/app/sshCommands.js';
import * as sqlCommands from '../api/app/sqlCommands.js';

const router = express.Router();

router.get('/:projectId/environments', requireAuth, environment.getEnvironments);
router.get('/:projectId/:environment/nodes', requireAuth, nodes.getNodes);
router.post('/:projectId/:environment/sshcommand', requireAuth, sshCommands.runCommands);
router.post('/:projectId/:environment/sqlquery',  sqlCommands.runQueries);

export default router;