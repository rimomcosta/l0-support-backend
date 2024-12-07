import express from 'express';
import { conditionalAuth } from '../middleware/auth.js';
import * as environment from '../api/app/environment.js';
import * as nodes from '../api/app/nodes.js';
import * as sshCommands from '../api/app/sshCommands.js';
import * as sqlCommands from '../api/app/sqlCommands.js';
import * as redisCommands from '../api/app/redisCommands.js';
import * as openSearchCommands from '../api/app/openSearchCommands.js';
import * as magentoCloudDirectAccess from '../api/app/magentoCloudDirectAccess.js';

const router = express.Router();

router.get('/:projectId/environments', conditionalAuth, environment.getEnvironments);
router.get('/:projectId/:environment/nodes', conditionalAuth, nodes.getNodes);
router.post('/:projectId/:environment/sshcommand', conditionalAuth, sshCommands.runCommands);
router.post('/:projectId/:environment/sqlquery', conditionalAuth, sqlCommands.runQueries);
router.post('/:projectId/:environment/redisquery', conditionalAuth, redisCommands.runQueries);
router.post('/:projectId/:environment/searchquery', conditionalAuth, openSearchCommands.runQueries);
router.post('/:projectId/:environment/magentocloud/:instance?', conditionalAuth, magentoCloudDirectAccess.executeCommand);


export default router;