// src/routes/appRoutes.js
import express from 'express';
import { requireAuth, conditionalAuth } from '../middleware/auth.js';
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
import chatApiRouter from '../api/app/chatApi.js';
import dashboardLayoutRoutes from './dashboardLayoutRoutes.js';
import aiSettingsRoutes from './aiSettingsRoutes.js';

const router = express.Router();

// Dashboard layout routes
router.use('/', dashboardLayoutRoutes);

// AI settings routes  
router.use('/', aiSettingsRoutes);

router.get('/:projectId/environments', requireAuth, environment.getEnvironments);
router.get('/:projectId/:environment/nodes', conditionalAuth, nodes.getNodes);
router.post('/:projectId/:environment/open-tunnel', requireAuth, openTunnel);
router.post('/:projectId/:environment/sshcommand', requireAuth, sshCommands.runCommands);
router.post('/:projectId/:environment/sqlquery', requireAuth, sqlCommands.runQueries);
router.post('/:projectId/:environment/redisquery', requireAuth, redisCommands.runQueries);
router.post('/:projectId/:environment/searchquery', requireAuth, openSearchCommands.runQueries);
router.post('/:projectId/:environment/magentocloud/:instance?', requireAuth, magentoCloudDirectAccess.executeCommands);
router.get('/command/:id', requireAuth, commands.getCommand);
router.get('/commands', requireAuth, commands.getCommands);
router.post('/commands', requireAuth, commands.createCommand);
router.put('/commands/:id', requireAuth, commands.updateCommand);
router.put('/commands/toggle/:id', requireAuth, commands.toggleCommand);
router.delete('/command/:id', requireAuth, commands.deleteCommand);
router.get('/:projectId/:environment/commands', 
    (req, res, next) => {
        console.log('=== COMMANDS ROUTE HIT ===', {
            projectId: req.params.projectId,
            environment: req.params.environment,
            url: req.url,
            path: req.path,
            method: req.method,
            hasSession: !!req.session,
            hasUser: !!req.session?.user
        });
        next();
    },
    requireAuth, 
    commands.executeAllCommands
);
// New route for single command execution
router.post('/command/execute', requireAuth, commands.executeSingleCommand);
router.post('/bashcommand', requireAuth, bashCommands.runCommands);
router.post('/command/refresh-service', requireAuth, commands.refreshService);
router.post('/ai/generate-component-code', requireAuth, ai.generateComponentCode);
router.get('/ai/chat/:chatId', requireAuth, getChatMessages); //Use in IntelligencePage.js

// Chat API routes
router.use('/chat', requireAuth, chatApiRouter);

export default router;