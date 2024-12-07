import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';

function replacePlaceholders(command, context) {
    let processedCommand = command.replace(/:projectid/g, context.projectId);
    
    // Handle environment placeholder
    if (context.environment) {
        processedCommand = processedCommand.replace(/:environment/g, context.environment);
    } else {
        // Remove environment-related parameters if no environment is provided
        processedCommand = processedCommand
            .replace(/\s+--environment\s+:environment/g, '')
            .replace(/\s+-e\s+:environment/g, '');
    }
    
    // Handle instance placeholder
    if (context.instance) {
        processedCommand = processedCommand.replace(/:instance/g, context.instance);
    } else {
        // Remove instance-related parameters if no instance is provided
        processedCommand = processedCommand
            .replace(/\s+--instance\s+:instance/g, '')
            .replace(/\s+-i\s+:instance/g, '');
    }
    
    return processedCommand;
}

export async function executeCommand(req, res) {
    const { projectId, environment, instance } = req.params;
    const { command } = req.body;

    if (!command) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Command is required'
        });
    }

    try {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        // Replace placeholders in the command
        const context = { 
            projectId, 
            environment: environment || null,
            instance: instance || null
        };
        
        const processedCommand = replacePlaceholders(command, context);

        logger.debug('Executing direct command:', {
            originalCommand: command,
            processedCommand,
            projectId,
            environment,
            instance
        });

        const { stdout, stderr } = await magentoCloud.executeCommand(processedCommand);

        res.json({
            command: processedCommand,
            output: stdout,
            error: stderr || null,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Direct command execution failed:', {
            error: error.message,
            command,
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