// src/services/rabbitmqAdminService.js
import { logger } from './logger.js';
import { executeCommand } from '../api/app/magentoCloudDirectAccess.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

export class RabbitMQAdminService {
    constructor(projectId, environment, apiToken, userId) {
        this.projectId = projectId;
        this.environment = environment;
        this.apiToken = apiToken;
        this.userId = userId;
        this.magentoCloud = new MagentoCloudAdapter();
    }

    async executeCommand(command) {
        console.log('userId from rabbitmqAdminService========================>', this.userId);
        try {
            // Extract RabbitMQ details from environment variable
            const rabbitmqHost = `$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .rabbitmq[0].host)`;
            const rabbitmqUsername = `$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .rabbitmq[0].username)`;
            const rabbitmqPassword = `$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .rabbitmq[0].password)`;

            // Use port 15672 for RabbitMQ Management UI (or extract from MAGENTO_CLOUD_RELATIONSHIPS if available)
            const rabbitmqManagementPort = "15672";  // Update if you can get it from the environment

            // Construct the rabbitmqadmin command (explicitly use HTTP/HTTPS if needed)
            const rabbitmqCommand = `'rabbitmqadmin -H ${rabbitmqHost} -P ${rabbitmqManagementPort} -u ${rabbitmqUsername} -p ${rabbitmqPassword} ${command}'`;

            // Construct the full SSH command
            const sshCommand = `magento-cloud ssh -p ${this.projectId} -e ${this.environment} ${rabbitmqCommand}`;

            logger.debug('Executing RabbitMQ command via SSH:', { command: sshCommand });

            const { output, error, status } = await executeCommand(
                this.magentoCloud,
                sshCommand,
                { projectId: this.projectId, environment: this.environment },
                this.apiToken,
                this.userId
            );

            if (status === 'ERROR') {
                throw new Error(error || 'RabbitMQ command execution failed (via SSH)');
            }

            return output;
        } catch (error) {
            logger.error('RabbitMQ command execution failed (via SSH):', {
                error: error.message,
                command,
                projectId: this.projectId,
                environment: this.environment
            });
            throw error;
        }
    }
}