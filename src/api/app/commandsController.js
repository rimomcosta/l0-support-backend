// src/api/app/commandsController.js
import * as commands from './commands.js';
import { logger } from '../../services/logger.js';

// Middleware for logging command route hits
export function logCommandRouteHit(req, res, next) {
    logger.info('=== COMMANDS ROUTE HIT ===', {
        projectId: req.params.projectId,
        environment: req.params.environment,
        url: req.url,
        path: req.path,
        method: req.method,
        hasSession: !!req.session,
        hasUser: !!req.session?.user
    });
    next();
}

// Execute all commands
export async function executeAllCommands(req, res) {
    return await commands.executeAllCommands(req, res);
}

// Get command by ID
export async function getCommand(req, res) {
    return await commands.getCommand(req, res);
}

// Get all commands
export async function getCommands(req, res) {
    return await commands.getCommands(req, res);
}

// Create command
export async function createCommand(req, res) {
    return await commands.createCommand(req, res);
}

// Update command
export async function updateCommand(req, res) {
    return await commands.updateCommand(req, res);
}

// Toggle command
export async function toggleCommand(req, res) {
    return await commands.toggleCommand(req, res);
}

// Delete command
export async function deleteCommand(req, res) {
    return await commands.deleteCommand(req, res);
}

// Execute single command
export async function executeSingleCommand(req, res) {
    return await commands.executeSingleCommand(req, res);
}

// Refresh service
export async function refreshService(req, res) {
    return await commands.refreshService(req, res);
}
