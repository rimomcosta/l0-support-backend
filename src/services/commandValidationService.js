// src/services/commandValidationService.js
import { logger } from './logger.js';

export class CommandValidationService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Validates SSH commands structure and content
     * @param {Array} commands - Array of command objects
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateSSHCommands(commands) {
        if (!Array.isArray(commands) || commands.length === 0) {
            return {
                valid: false,
                errors: ['Commands must be a non-empty array']
            };
        }

        const validationErrors = [];
        const seenIds = new Set();

        commands.forEach((cmd, index) => {
            const errors = this.validateCommand(cmd, index);
            if (errors.length > 0) {
                validationErrors.push({
                    index,
                    commandId: cmd.id,
                    errors
                });
            }

            // Check for duplicate IDs
            if (cmd.id) {
                if (seenIds.has(cmd.id)) {
                    validationErrors.push({
                        index,
                        commandId: cmd.id,
                        errors: [`Duplicate command ID found: ${cmd.id}`]
                    });
                } else {
                    seenIds.add(cmd.id);
                }
            }
        });

        return {
            valid: validationErrors.length === 0,
            errors: validationErrors
        };
    }

    /**
     * Validates SQL queries structure and content
     * @param {Array} queries - Array of query objects
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateSQLQueries(queries) {
        if (!Array.isArray(queries) || queries.length === 0) {
            return {
                valid: false,
                errors: ['Queries must be a non-empty array']
            };
        }

        const validationErrors = [];
        const seenIds = new Set();

        queries.forEach((query, index) => {
            const errors = this.validateQuery(query, index);
            if (errors.length > 0) {
                validationErrors.push({
                    index,
                    queryId: query.id,
                    errors
                });
            }

            // Check for duplicate IDs
            if (query.id) {
                if (seenIds.has(query.id)) {
                    validationErrors.push({
                        index,
                        queryId: query.id,
                        errors: [`Duplicate query ID found: ${query.id}`]
                    });
                } else {
                    seenIds.add(query.id);
                }
            }
        });

        return {
            valid: validationErrors.length === 0,
            errors: validationErrors
        };
    }

    /**
     * Validates Redis commands structure and content
     * @param {Array} queries - Array of Redis command objects
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateRedisCommands(queries) {
        if (!Array.isArray(queries)) {
            return {
                valid: false,
                errors: ['Commands must be an array']
            };
        }

        const validationErrors = [];
        const seenIds = new Set();

        queries.forEach((query, index) => {
            const errors = this.validateRedisCommand(query, index);
            if (errors.length > 0) {
                validationErrors.push({
                    index,
                    commandId: query.id,
                    errors
                });
            }

            // Check for duplicate IDs
            if (query.id) {
                if (seenIds.has(query.id)) {
                    validationErrors.push({
                        index,
                        commandId: query.id,
                        errors: [`Duplicate command ID found: ${query.id}`]
                    });
                } else {
                    seenIds.add(query.id);
                }
            }
        });

        return {
            valid: validationErrors.length === 0,
            errors: validationErrors
        };
    }

    /**
     * Validates OpenSearch commands structure and content
     * @param {Array} queries - Array of OpenSearch command objects
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateOpenSearchCommands(queries) {
        if (!Array.isArray(queries)) {
            return {
                valid: false,
                errors: ['Commands must be an array']
            };
        }

        const validationErrors = [];
        const seenIds = new Set();

        queries.forEach((query, index) => {
            const errors = this.validateOpenSearchCommand(query, index);
            if (errors.length > 0) {
                validationErrors.push({
                    index,
                    commandId: query.id,
                    errors
                });
            }

            // Check for duplicate IDs
            if (query.id) {
                if (seenIds.has(query.id)) {
                    validationErrors.push({
                        index,
                        commandId: query.id,
                        errors: [`Duplicate command ID found: ${query.id}`]
                    });
                } else {
                    seenIds.add(query.id);
                }
            }
        });

        return {
            valid: validationErrors.length === 0,
            errors: validationErrors
        };
    }

    /**
     * Validates Magento Cloud commands structure and content
     * @param {Array} commands - Array of Magento Cloud command objects
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateMagentoCloudCommands(commands) {
        if (!Array.isArray(commands)) {
            return {
                valid: false,
                errors: ['Commands must be an array']
            };
        }

        const validationErrors = [];
        const seenIds = new Set();

        commands.forEach((cmd, index) => {
            const errors = this.validateMagentoCloudCommand(cmd, index);
            if (errors.length > 0) {
                validationErrors.push({
                    index,
                    commandId: cmd.id,
                    errors
                });
            }

            // Check for duplicate IDs
            if (cmd.id) {
                if (seenIds.has(cmd.id)) {
                    validationErrors.push({
                        index,
                        commandId: cmd.id,
                        errors: [`Duplicate command ID found: ${cmd.id}`]
                    });
                } else {
                    seenIds.add(cmd.id);
                }
            }
        });

        return {
            valid: validationErrors.length === 0,
            errors: validationErrors
        };
    }

    /**
     * Validates Bash commands structure and content
     * @param {Array} commands - Array of Bash command objects
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateBashCommands(commands) {
        if (!Array.isArray(commands)) {
            return {
                valid: false,
                errors: ['Commands must be an array']
            };
        }

        const validationErrors = [];
        const seenIds = new Set();

        commands.forEach((cmd, index) => {
            const errors = this.validateBashCommand(cmd, index);
            if (errors.length > 0) {
                validationErrors.push({
                    index,
                    commandId: cmd.id,
                    errors
                });
            }

            // Check for duplicate IDs
            if (cmd.id) {
                if (seenIds.has(cmd.id)) {
                    validationErrors.push({
                        index,
                        commandId: cmd.id,
                        errors: [`Duplicate command ID found: ${cmd.id}`]
                    });
                } else {
                    seenIds.add(cmd.id);
                }
            }
        });

        return {
            valid: validationErrors.length === 0,
            errors: validationErrors
        };
    }

    /**
     * Validates RabbitMQ commands structure and content
     * @param {Array} commands - Array of RabbitMQ command objects
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateRabbitMQCommands(commands) {
        if (!Array.isArray(commands)) {
            return {
                valid: false,
                errors: ['Commands must be an array']
            };
        }

        const validationErrors = [];
        const seenIds = new Set();

        commands.forEach((cmd, index) => {
            const errors = this.validateRabbitMQCommand(cmd, index);
            if (errors.length > 0) {
                validationErrors.push({
                    index,
                    commandId: cmd.id,
                    errors
                });
            }

            // Check for duplicate IDs
            if (cmd.id) {
                if (seenIds.has(cmd.id)) {
                    validationErrors.push({
                        index,
                        commandId: cmd.id,
                        errors: [`Duplicate command ID found: ${cmd.id}`]
                    });
                } else {
                    seenIds.add(cmd.id);
                }
            }
        });

        return {
            valid: validationErrors.length === 0,
            errors: validationErrors
        };
    }

    /**
     * Generic command validation for SSH/Bash/Magento Cloud commands
     * @param {Object} cmd - Command object
     * @param {number} index - Command index in array
     * @returns {Array} - Array of validation errors
     */
    validateCommand(cmd, index) {
        const errors = [];

        // Check required fields
        if (!cmd.id) errors.push('Missing id');
        if (!cmd.title) errors.push('Missing title');
        if (!cmd.command) errors.push('Missing command');
        if (typeof cmd.executeOnAllNodes !== 'boolean') {
            errors.push('Missing or invalid executeOnAllNodes');
        }

        // Validate command string
        if (cmd.command && typeof cmd.command === 'string') {
            if (cmd.command.trim().length === 0) {
                errors.push('Empty command string');
            }
        }

        return errors;
    }

    /**
     * Generic query validation for SQL queries
     * @param {Object} query - Query object
     * @param {number} index - Query index in array
     * @returns {Array} - Array of validation errors
     */
    validateQuery(query, index) {
        const errors = [];

        if (!query.id) errors.push(`Query at index ${index} is missing 'id'`);
        if (!query.title) errors.push(`Query at index ${index} is missing 'title'`);
        if (!query.query) errors.push(`Query at index ${index} is missing 'query'`);
        if (typeof query.executeOnAllNodes !== 'boolean') {
            errors.push(`Query at index ${index} is missing 'executeOnAllNodes' or it's not a boolean`);
        }

        if (query.query && typeof query.query === 'string') {
            if (query.query.trim().length === 0) {
                errors.push(`Query at index ${index} has empty query string`);
            }
        }

        return errors;
    }

    /**
     * Redis command validation
     * @param {Object} query - Redis command object
     * @param {number} index - Command index in array
     * @returns {Array} - Array of validation errors
     */
    validateRedisCommand(query, index) {
        const errors = [];

        if (!query.id) errors.push(`Command at index ${index} is missing 'id'`);
        if (!query.title) errors.push(`Command at index ${index} is missing 'title'`);
        if (!query.query) errors.push(`Command at index ${index} is missing 'query'`);

        if (query.query && typeof query.query === 'string') {
            if (query.query.trim().length === 0) {
                errors.push(`Command at index ${index} has empty query string`);
            }
        }

        return errors;
    }

    /**
     * OpenSearch command validation
     * @param {Object} query - OpenSearch command object
     * @param {number} index - Command index in array
     * @returns {Array} - Array of validation errors
     */
    validateOpenSearchCommand(query, index) {
        const errors = [];

        if (!query.id) errors.push(`Command at index ${index} is missing 'id'`);
        if (!query.title) errors.push(`Command at index ${index} is missing 'title'`);
        if (!query.command) errors.push(`Command at index ${index} is missing 'command'`);

        // Validate command structure (should be JSON)
        if (query.command) {
            try {
                if (typeof query.command === 'string') {
                    JSON.parse(query.command);
                } else if (typeof query.command === 'object') {
                    // Already parsed, validate structure
                    if (!query.command.index && !query.command.body) {
                        errors.push(`Command at index ${index} has invalid OpenSearch structure`);
                    }
                }
            } catch (parseError) {
                errors.push(`Command at index ${index} has invalid JSON structure`);
            }
        }

        return errors;
    }

    /**
     * Magento Cloud command validation
     * @param {Object} cmd - Magento Cloud command object
     * @param {number} index - Command index in array
     * @returns {Array} - Array of validation errors
     */
    validateMagentoCloudCommand(cmd, index) {
        const errors = [];

        if (!cmd.id) errors.push(`Command at index ${index} is missing 'id'`);
        if (!cmd.title) errors.push(`Command at index ${index} is missing 'title'`);
        if (!cmd.command) errors.push(`Command at index ${index} is missing 'command'`);

        if (cmd.command && typeof cmd.command === 'string') {
            if (cmd.command.trim().length === 0) {
                errors.push(`Command at index ${index} has empty command string`);
            }
        }

        return errors;
    }

    /**
     * Bash command validation
     * @param {Object} cmd - Bash command object
     * @param {number} index - Command index in array
     * @returns {Array} - Array of validation errors
     */
    validateBashCommand(cmd, index) {
        const errors = [];

        if (!cmd.id) errors.push(`Command at index ${index} is missing 'id'`);
        if (!cmd.title) errors.push(`Command at index ${index} is missing 'title'`);
        if (!cmd.command) errors.push(`Command at index ${index} is missing 'command'`);

        if (cmd.command && typeof cmd.command === 'string') {
            if (cmd.command.trim().length === 0) {
                errors.push(`Command at index ${index} has empty command string`);
            }
        }

        return errors;
    }

    /**
     * RabbitMQ command validation
     * @param {Object} cmd - RabbitMQ command object
     * @param {number} index - Command index in array
     * @returns {Array} - Array of validation errors
     */
    validateRabbitMQCommand(cmd, index) {
        const errors = [];

        if (!cmd.id) errors.push(`Command at index ${index} is missing 'id'`);
        if (!cmd.title) errors.push(`Command at index ${index} is missing 'title'`);
        if (!cmd.command) errors.push(`Command at index ${index} is missing 'command'`);

        if (cmd.command && typeof cmd.command === 'string') {
            if (cmd.command.trim().length === 0) {
                errors.push(`Command at index ${index} has empty command string`);
            }
        }

        return errors;
    }

    /**
     * Validates command creation/update data
     * @param {Object} commandData - Command data object
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateCommandData(commandData) {
        const errors = [];

        // Required fields
        if (!commandData.title) errors.push('Title is required');
        if (!commandData.command) errors.push('Command is required');
        if (!commandData.serviceType) errors.push('Service type is required');

        // Validate service type
        const validServiceTypes = ['ssh', 'sql', 'redis', 'opensearch', 'magento_cloud', 'bash', 'rabbitmq'];
        if (commandData.serviceType && !validServiceTypes.includes(commandData.serviceType)) {
            errors.push(`Invalid service type: ${commandData.serviceType}`);
        }

        // Validate boolean fields
        if (typeof commandData.executeOnAllNodes !== 'boolean') {
            errors.push('executeOnAllNodes must be a boolean');
        }
        if (typeof commandData.allowAi !== 'boolean') {
            errors.push('allowAi must be a boolean');
        }
        if (typeof commandData.autoRun !== 'boolean') {
            errors.push('autoRun must be a boolean');
        }
        if (typeof commandData.reviewed !== 'boolean') {
            errors.push('reviewed must be a boolean');
        }

        // Validate command string
        if (commandData.command && typeof commandData.command === 'string') {
            if (commandData.command.trim().length === 0) {
                errors.push('Command cannot be empty');
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validates project and environment parameters
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateProjectEnvironment(projectId, environment) {
        const errors = [];

        if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
            errors.push('Project ID is required');
        }

        if (!environment || typeof environment !== 'string' || environment.trim().length === 0) {
            errors.push('Environment is required');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validates API token presence
     * @param {string} apiToken - API token
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateApiToken(apiToken) {
        const errors = [];

        if (!apiToken) {
            errors.push('API token is required');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validates user session
     * @param {Object} session - User session object
     * @returns {Object} - Validation result with valid flag and errors array
     */
    validateUserSession(session) {
        const errors = [];

        if (!session || !session.user) {
            errors.push('User session is required');
        } else if (!session.user.id) {
            errors.push('User ID is required');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
}
