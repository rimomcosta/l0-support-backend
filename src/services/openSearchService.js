import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger.js';

const execAsync = promisify(exec);

export class OpenSearchService {
    constructor(tunnelInfo) {
        if (!tunnelInfo?.opensearch?.[0]) {
            throw new Error('Invalid tunnel info: missing opensearch configuration');
        }

        const searchInfo = tunnelInfo.opensearch[0];
        this.host = searchInfo.host;
        this.port = searchInfo.port;
        this.username = searchInfo.username;
        this.password = searchInfo.password;

        logger.debug('OpenSearch Service initialized with config:', {
            host: this.host,
            port: this.port,
            username: this.username
        });
    }

    async executeCommand(command) {
        try {
            // Check if path starts with _cat as these endpoints return text
            const isTextResponse = command.path.startsWith('/_cat/');
            
            // Use -H "Accept: application/json" only for JSON responses
            const headers = isTextResponse ? 
                '-H "Content-Type: application/json"' : 
                '-H "Content-Type: application/json" -H "Accept: application/json"';

            const curlCommand = `curl -s -S -X ${command.method || 'GET'} ` +
                `-u "${this.username}:${this.password}" ` +
                `${headers} ` +
                `${command.data ? `-d '${JSON.stringify(command.data)}' ` : ''}` +
                `"http://${this.host}:${this.port}${command.path}"`;

            logger.debug('Executing OpenSearch command:', { 
                method: command.method,
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

            // For _cat endpoints, return the text output directly
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