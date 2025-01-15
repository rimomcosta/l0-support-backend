// src/services/OpenSearchService.js
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';

const execAsync = promisify(exec);

/**
 * OpenSearchService handles executing commands against OpenSearch or Elasticsearch services.
 * It dynamically handles service names based on the tunnel information.
 */
export class OpenSearchService {
    /**
     * @param {Object} tunnelInfo - The tunnel information object.
     * @param {String} serviceType - The service type ('opensearch' or 'elasticsearch').
     */
    constructor(tunnelInfo, serviceType = 'opensearch') {
        this.serviceType = serviceType.toLowerCase();
        if (!['opensearch', 'elasticsearch'].includes(this.serviceType)) {
            throw new Error('Service type must be either "opensearch" or "elasticsearch"');
        }

        if (!tunnelInfo?.[this.serviceType]?.[0]) {
            throw new Error(`Invalid tunnel info: missing ${this.serviceType} configuration`);
        }

        const serviceInfo = tunnelInfo[this.serviceType][0];
        this.host = serviceInfo.host;
        this.port = serviceInfo.port;
        this.username = serviceInfo.username;
        this.password = serviceInfo.password;

        logger.debug('OpenSearchService initialized with config:', {
            serviceType: this.serviceType,
            host: this.host,
            port: this.port,
            username: this.username
        });
    }

    /**
     * Executes a command against the OpenSearch/Elasticsearch service using curl.
     * @param {Object} command - The command object containing method, path, and data.
     * @returns {Promise<Object|string>} - The response from the service.
     */
    async executeCommand(command) {
        try {
            // Validate command object
            if (!command || !command.path) {
                throw new Error('Invalid command object: missing path');
            }

            // Determine if the response should be treated as text
            const isTextResponse = command.path.startsWith('/_cat/') || command.path.startsWith('/_cluster/health');

            // Set headers accordingly
            const headers = isTextResponse
                ? '-H "Content-Type: application/json"'
                : '-H "Content-Type: application/json" -H "Accept: application/json"';

            // Construct the curl command securely
            const curlCommand = `curl -s -S -X ${command.method || 'GET'} ` +
                `-u "${this.username}:${this.password}" ` +
                `${headers} ` +
                `${command.data ? `-d '${JSON.stringify(command.data)}' ` : ''}` +
                `"http://${this.host}:${this.port}${command.path}"`;

            logger.debug('Executing OpenSearch command:', { 
                method: command.method || 'GET',
                path: command.path,
                host: this.host,
                port: this.port,
                responseType: isTextResponse ? 'text' : 'json'
            });

            const { stdout, stderr } = await execAsync(curlCommand);
            
            if (stderr) {
                logger.error('OpenSearch stderr output:', { stderr });
                throw new Error(stderr);
            }

            // For _cat and similar endpoints, return the text output directly
            if (isTextResponse) {
                return stdout.trim();
            }

            // For other endpoints, parse as JSON
            try {
                return JSON.parse(stdout.trim());
            } catch (parseError) {
                logger.error('Failed to parse OpenSearch response:', { 
                    output: stdout,
                    error: parseError.message 
                });
                // If JSON parsing fails, return the raw output
                return stdout.trim();
            }
        } catch (error) {
            logger.error('OpenSearch command execution failed:', {
                error: error.message,
                command: command.path,
                host: this.host,
                port: this.port
            });
            throw error;
        }
    }
}
