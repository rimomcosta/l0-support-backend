// src/routes/appRoutes.js
import express from 'express';
import { conditionalAuth } from '../middleware/auth.js';
import * as environment from '../api/app/environment.js';
import * as nodes from '../api/app/nodes.js';
import * as sshCommands from '../api/app/sshCommands.js';
import * as sqlCommands from '../api/app/sqlCommands.js';
import * as redisCommands from '../api/app/redisCommands.js';
import * as openSearchCommands from '../api/app/openSearchCommands.js';
import * as magentoCloudDirectAccess from '../api/app/magentoCloudDirectAccess.js';
import * as commands from '../api/app/commands.js';
import * as bashCommands from '../api/app/bashCommands.js';
import { openTunnel } from '../api/app/tunnel.js';
import * as ai from '../api/app/ai.js';
import { getChatMessages } from '../api/app/chatApi.js';
import dashboardLayoutRoutes from './dashboardLayoutRoutes.js';

const router = express.Router();

// Dashboard layout routes
router.use('/', dashboardLayoutRoutes);

router.get('/:projectId/environments', conditionalAuth, environment.getEnvironments);
router.get('/:projectId/:environment/nodes', conditionalAuth, nodes.getNodes);
router.post('/:projectId/:environment/open-tunnel', conditionalAuth, openTunnel);
router.post('/:projectId/:environment/sshcommand', conditionalAuth, sshCommands.runCommands);
router.post('/:projectId/:environment/sqlquery', conditionalAuth, sqlCommands.runQueries);
router.post('/:projectId/:environment/redisquery', conditionalAuth, redisCommands.runQueries);
router.post('/:projectId/:environment/searchquery', conditionalAuth, openSearchCommands.runQueries);
router.post('/:projectId/:environment/magentocloud/:instance?', conditionalAuth, magentoCloudDirectAccess.executeCommands);
router.get('/command/:id', conditionalAuth, commands.getCommand);
router.get('/commands', conditionalAuth, commands.getCommands);
router.post('/commands', conditionalAuth, commands.createCommand);
router.put('/commands/:id', conditionalAuth, commands.updateCommand);
router.put('/commands/toggle/:id', conditionalAuth, commands.toggleCommand);
router.delete('/command/:id', conditionalAuth, commands.deleteCommand);
router.get('/:projectId/:environment/commands', conditionalAuth, commands.executeAllCommands);
// New route for single command execution
router.post('/command/execute', conditionalAuth, commands.executeSingleCommand);
router.post('/bashcommand', conditionalAuth, bashCommands.runCommands);
router.post('/command/refresh-service', conditionalAuth, commands.refreshService);
router.post('/ai/generate-component-code', conditionalAuth, ai.generateComponentCode);
router.get('/ai/chat/:chatId', conditionalAuth, getChatMessages); //Use in IntelligencePage.js

export default router;