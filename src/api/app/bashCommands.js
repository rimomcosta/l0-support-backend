// src/api/app/bashCommands.js
import { logger } from '../../services/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function runCommands(req, res) {
    const { projectId, environment } = req.params;
    const { commands } = req.body;
    const userId = req.session.user.id;
    const apiToken = req.session.decryptedApiToken; // Get apiToken from session
if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    if (!apiToken) {
        return res.status(401).json({ error: 'API token not found for user' });
    }

    const results = [];
    try {
        for (const cmd of commands) {
            try {
                // Option 1: Set MAGENTO_CLOUD_CLI_TOKEN as an environment variable (more secure)
                const { stdout, stderr } = await execAsync(cmd.command, {
                    maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                    env: {
                        ...process.env, // Inherit existing environment variables
                        MAGENTO_CLOUD_CLI_TOKEN: apiToken
                    }
                });

                // Option 2: (Less secure) Pass the token as part of the command string itself
                // const commandToExecute = `${cmd.command} --api-token="${apiToken}"`;
                // const { stdout, stderr } = await execAsync(commandToExecute, {
                //     maxBuffer: 1024 * 1024 * 10 // 10MB buffer
                // });

                results.push({
                    id: cmd.id,
                    title: cmd.title,
                    command: cmd.command,
                    allowAi: cmd.allowAi,
                    results: [{
                        nodeId: 'bash',
                        output: stdout || null,
                        error: stderr || null,
                        status: stderr ? 'ERROR' : 'SUCCESS'
                    }],
                    summary: {
                        total: 1,
                        successful: stderr ? 0 : 1,
                        failed: stderr ? 1 : 0
                    }
                });
            } catch (cmdError) {
                results.push({
                    id: cmd.id,
                    title: cmd.title,
                    command: cmd.command,
                    allowAi: cmd.allowAi,
                    results: [{
                        nodeId: 'bash',
                        output: null,
                        error: cmdError.message,
                        status: 'ERROR'
                    }],
                    summary: {
                        total: 1,
                        successful: 0,
                        failed: 1
                    }
                });
            }
        }

        res.json({
            timestamp: new Date().toISOString(),
            results
        });

    } catch (error) {
        logger.error('Bash commands execution failed:', error);
        res.status(500).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
}