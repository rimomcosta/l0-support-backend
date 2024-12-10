import { CommandService } from '../../services/commandService.js';
import { WebSocketService } from '../../services/webSocketService.js';
import { logger } from '../../services/logger.js';

const commandService = new CommandService();

// CRUD Operations
export async function createCommand(req, res) {
    try {
        const id = await commandService.create(req.body);
        res.status(201).json({ id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function updateCommand(req, res) {
    try {
        await commandService.update(req.params.id, req.body);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function deleteCommand(req, res) {
    try {
        await commandService.delete(req.params.id);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getCommands(req, res) {
    try {
        const commands = await commandService.getAll();
        res.json(commands);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Command Execution
export async function executeCommand(req, res) {
    const { commandId } = req.params;
    const { projectId, environment } = req.query;
    const ws = WebSocketService.getClientConnection(req);

    try {
        const command = await commandService.getById(commandId);
        if (!command) {
            return res.status(404).json({ error: 'Command not found' });
        }

        // Start execution asynchronously
        executeCommandAsync(command, projectId, environment, ws);

        // Return immediate response
        res.json({ 
            message: 'Command execution started',
            commandId,
            status: 'pending'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function executeCommandAsync(command, projectId, environment, ws) {
    try {
        const service = getServiceForCommand(command.service_type);
        const result = await service.execute(command, projectId, environment);
        
        ws.send(JSON.stringify({
            type: 'command_result',
            commandId: command.id,
            title: command.title,
            command: command.command,
            result
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'command_error',
            commandId: command.id,
            error: error.message
        }));
    }
}