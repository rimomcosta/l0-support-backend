// src/services/hipaaDetectionService.js
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

export class HipaaDetectionService {
    constructor() {
        this.magentoCloud = new MagentoCloudAdapter();
    }

    /**
     * Checks if a project is HIPAA by executing the subscription:info command
     * @param {string} projectId - The project ID to check
     * @param {string} apiToken - The API token for authentication
     * @param {string} userId - The user ID for Magento Cloud home directory
     * @returns {Promise<Object>} - Object with isHipaa boolean and project info
     */
    async checkProjectHipaaStatus(projectId, apiToken, userId) {
        try {
            logger.info('Checking HIPAA status for project:', { projectId });

            // Validate executable
            await this.magentoCloud.validateExecutable();

            // Execute the subscription:info command to get HIPAA status
            // Use the same command format as stored in the database (command ID 28)
            const command = `magento-cloud subscription:info -p ${projectId} | grep -E "created_at|project_title|status|project_region|project_ui|id|plan|environments|storage|user_licenses|hipaa"`;
            
            const { stdout, stderr } = await this.magentoCloud.executeCommand(command, apiToken, userId);

            if (stderr) {
                logger.error('Error executing HIPAA check command:', { 
                    projectId, 
                    error: stderr 
                });
                throw new Error(`Failed to check HIPAA status: ${stderr}`);
            }

            if (!stdout) {
                logger.warn('No output from HIPAA check command:', { projectId });
                throw new Error('No output received from HIPAA check command');
            }

            // Parse the output to extract HIPAA status and project info
            const result = this.parseSubscriptionInfo(stdout);
            
            logger.info('HIPAA check completed:', { 
                projectId, 
                isHipaa: result.isHipaa,
                projectTitle: result.projectTitle 
            });

            return result;

        } catch (error) {
            logger.error('Failed to check HIPAA status:', {
                projectId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Parses the subscription:info command output to extract HIPAA status and project info
     * @param {string} output - The command output
     * @returns {Object} - Parsed result with isHipaa, projectTitle, and other info
     */
    parseSubscriptionInfo(output) {
        const lines = output.split('\n');
        const result = {
            isHipaa: false,
            projectTitle: null,
            projectId: null,
            status: null,
            plan: null,
            environments: null,
            storage: null,
            userLicenses: null,
            created_at: null,
            project_region: null,
            project_ui: null
        };

        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Skip empty lines and separator lines
            if (!trimmedLine || trimmedLine.includes('|') && trimmedLine.includes('---')) {
                continue;
            }

            // Extract HIPAA status
            if (trimmedLine.includes('hipaa')) {
                const hipaaMatch = trimmedLine.match(/hipaa\s*\|\s*(true|false)/i);
                if (hipaaMatch) {
                    result.isHipaa = hipaaMatch[1].toLowerCase() === 'true';
                }
            }

            // Extract project title
            if (trimmedLine.includes('project_title')) {
                const titleMatch = trimmedLine.match(/project_title\s*\|\s*(.+)/i);
                if (titleMatch) {
                    result.projectTitle = titleMatch[1].trim();
                }
            }

            // Extract project ID
            if (trimmedLine.includes('project_id')) {
                const idMatch = trimmedLine.match(/project_id\s*\|\s*(.+)/i);
                if (idMatch) {
                    result.projectId = idMatch[1].trim();
                }
            }

            // Extract status
            if (trimmedLine.includes('status')) {
                const statusMatch = trimmedLine.match(/status\s*\|\s*(.+)/i);
                if (statusMatch) {
                    result.status = statusMatch[1].trim();
                }
            }

            // Extract plan
            if (trimmedLine.includes('plan')) {
                const planMatch = trimmedLine.match(/plan\s*\|\s*(.+)/i);
                if (planMatch) {
                    result.plan = planMatch[1].trim();
                }
            }

            // Extract environments
            if (trimmedLine.includes('environments')) {
                const envMatch = trimmedLine.match(/environments\s*\|\s*(.+)/i);
                if (envMatch) {
                    result.environments = envMatch[1].trim();
                }
            }

            // Extract storage
            if (trimmedLine.includes('storage')) {
                const storageMatch = trimmedLine.match(/storage\s*\|\s*(.+)/i);
                if (storageMatch) {
                    result.storage = storageMatch[1].trim();
                }
            }

            // Extract user licenses
            if (trimmedLine.includes('user_licenses')) {
                const licensesMatch = trimmedLine.match(/user_licenses\s*\|\s*(.+)/i);
                if (licensesMatch) {
                    result.userLicenses = licensesMatch[1].trim();
                }
            }

            // Extract created_at
            if (trimmedLine.includes('created_at')) {
                const createdMatch = trimmedLine.match(/created_at\s*\|\s*(.+)/i);
                if (createdMatch) {
                    result.created_at = createdMatch[1].trim();
                }
            }

            // Extract project_region
            if (trimmedLine.includes('project_region')) {
                const regionMatch = trimmedLine.match(/project_region\s*\|\s*(.+)/i);
                if (regionMatch) {
                    result.project_region = regionMatch[1].trim();
                }
            }

            // Extract project_ui
            if (trimmedLine.includes('project_ui')) {
                const uiMatch = trimmedLine.match(/project_ui\s*\|\s*(.+)/i);
                if (uiMatch) {
                    result.project_ui = uiMatch[1].trim();
                }
            }
        }

        return result;
    }
}

export default new HipaaDetectionService();
