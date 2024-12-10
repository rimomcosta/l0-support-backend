// src/api/app/magentoCloudDirectAccess.js
import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';

function replacePlaceholders(command, context) {
    // First, remove any 'magento-cloud' prefix if it exists in the command
    let processedCommand = command.replace(/^magento-cloud\s+/, '');
    
    // Replace all placeholders
    processedCommand = processedCommand.replace(/:projectid/g, context.projectId);
    
    if (context.environment) {
        processedCommand = processedCommand.replace(/:environment/g, context.environment);
    } else {
        processedCommand = processedCommand
            .replace(/\s+--environment\s+:environment/g, '')
            .replace(/\s+-e\s+:environment/g, '');
    }
    
    if (context.instance) {
        processedCommand = processedCommand.replace(/:instance/g, context.instance);
    } else {
        processedCommand = processedCommand
            .replace(/\s+--instance\s+:instance/g, '')
            .replace(/\s+-i\s+:instance/g, '');
    }

    // Handle quoted commands (like "nproc")
    if (processedCommand.endsWith(' "nproc"')) {
        // Ensure proper quoting for SSH commands
        processedCommand = processedCommand.replace(/ "nproc"$/, ' \\"nproc\\"');
    }
    
    return processedCommand.trim();
}

async function executeCommand(magentoCloud, command, context) {
    try {
        const processedCommand = replacePlaceholders(command, context);

        logger.debug('Executing magento-cloud command:', {
            originalCommand: command,
            processedCommand,
            context
        });

        const { stdout, stderr } = await magentoCloud.executeCommand(processedCommand);

        return {
            output: stdout || null,
            error: stderr || null
        };
    } catch (error) {
        logger.error('Command execution failed:', {
            error: error.message,
            command,
            context
        });

        return {
            output: null,
            error: error.message
        };
    }
}

export async function executeCommands(req, res) {
    const { projectId, environment, instance } = req.params;
    const { commands } = req.body;

    if (!Array.isArray(commands)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Commands must be an array'
        });
    }

    try {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        const context = { 
            projectId, 
            environment: environment || null,
            instance: instance || null
        };

        const results = await Promise.all(commands.map(async (cmd) => {
            const { output, error } = await executeCommand(magentoCloud, cmd.command, context);
            
            return {
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                results: [{
                    output,
                    error
                }]
            };
        }));

        res.json({
            projectId,
            environment,
            instance: instance || undefined,
            timestamp: new Date().toISOString(),
            results
        });

    } catch (error) {
        logger.error('Commands execution failed:', {
            error: error.message,
            projectId,
            environment,
            instance
        });

        res.status(500).json({
            error: 'Command execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}