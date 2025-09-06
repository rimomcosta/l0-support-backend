// src/services/serviceExecutionService.js
import { logger, sshLogger, logSSHOperation } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';
import { execute as getNodes } from '../api/app/nodes.js';
import { tunnelManager } from './tunnelService.js';
import { SQLService } from './sqlService.js';
import { RedisCliService } from './redisCliService.js';
import { RabbitMQAdminService } from './rabbitmqAdminService.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { paths } from '../config/paths.js';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export class ServiceExecutionService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Execute SSH commands on nodes
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {Array} commands - Array of SSH commands
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Object} - Execution results
     */
    async executeSSHCommands(projectId, environment, commands, apiToken, userId) {
        logSSHOperation('info', 'Starting SSH command execution process', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            commandCount: commands.length,
            timestamp: new Date().toISOString()
        });

        // Get nodes for the project/environment
        const nodes = await getNodes(projectId, environment, apiToken, userId);
        
        if (!nodes || nodes.length === 0) {
            logSSHOperation('error', 'No nodes found for project/environment', {
                projectId: projectId,
                environment: environment,
                userId: userId,
                timestamp: new Date().toISOString()
            });
            
            throw new Error('No nodes found for the specified project and environment');
        }

        logSSHOperation('debug', 'Retrieved nodes for SSH execution', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            nodeCount: nodes.length,
            nodes: nodes.map(node => ({ id: node.id, sshUrl: node.sshUrl, status: node.status })),
            timestamp: new Date().toISOString()
        });

        const magentoCloud = new MagentoCloudAdapter();
        const isSingleNode = !nodes || nodes.length <= 1;
        const results = [];

        if (isSingleNode) {
            // Execute commands on single node
            logSSHOperation('debug', 'Executing commands on single node', {
                projectId: projectId,
                environment: environment,
                userId: userId,
                nodeId: 'single-node',
                commandCount: commands.length,
                timestamp: new Date().toISOString()
            });

            const nodeResults = await this.executeSSHCommandsOnNode(
                magentoCloud,
                projectId,
                environment,
                null, // nodeId is null for single node
                commands,
                true, // isSingleNode
                apiToken,
                userId
            );

            results.push(...nodeResults);
        } else {
            // Multi-node execution - Optimized to reduce duplicate connections to node 1
            const allNodesCommands = commands.filter(cmd => cmd.executeOnAllNodes);
            const singleNodeCommands = commands.filter(cmd => !cmd.executeOnAllNodes);

            // Execute combined commands on first node (single-node + all-nodes commands)
            if (singleNodeCommands.length > 0 || allNodesCommands.length > 0) {
                const node1Commands = [...singleNodeCommands, ...allNodesCommands];
                
                logSSHOperation('debug', `Executing combined commands on first node: ${nodes[0].sshUrl}`, {
                    projectId: projectId,
                    environment: environment,
                    userId: userId,
                    nodeId: nodes[0].id,
                    sshUrl: nodes[0].sshUrl,
                    singleNodeCommandCount: singleNodeCommands.length,
                    allNodesCommandCount: allNodesCommands.length,
                    totalCommandCount: node1Commands.length,
                    timestamp: new Date().toISOString()
                });

                const nodeResults = await this.executeSSHCommandsOnNode(
                    magentoCloud,
                    projectId,
                    environment,
                    nodes[0].id,
                    node1Commands,
                    false, // isSingleNode
                    apiToken,
                    userId
                );

                results.push(...nodeResults);
            }

            // Execute all-nodes commands on remaining nodes (skip first node to avoid duplication)
            if (allNodesCommands.length > 0 && nodes.length > 1) {
                for (let i = 1; i < nodes.length; i++) {
                    const node = nodes[i];
                    
                    logSSHOperation('debug', `Executing all-nodes commands on node: ${node.sshUrl}`, {
                        projectId: projectId,
                        environment: environment,
                        userId: userId,
                        nodeId: node.id,
                        sshUrl: node.sshUrl,
                        commandCount: allNodesCommands.length,
                        timestamp: new Date().toISOString()
                    });

                    const nodeResults = await this.executeSSHCommandsOnNode(
                        magentoCloud,
                        projectId,
                        environment,
                        node.id,
                        allNodesCommands,
                        false, // isSingleNode
                        apiToken,
                        userId
                    );

                    results.push(...nodeResults);
                }
            }
        }

        // Group results by command
        const commandResults = [];
        const commandsById = {};
        
        // Initialize command results structure
        commands.forEach(cmd => {
            commandsById[cmd.id] = {
                id: cmd.id,
                title: cmd.title,
                command: cmd.command,
                allowAi: cmd.allowAi,
                results: [],
                summary: {
                    total: 0,
                    successful: 0,
                    failed: 0
                }
            };
        });

        // Group node results by command
        results.forEach(result => {
            const commandResult = commandsById[result.commandId];
            if (commandResult) {
                commandResult.results.push({
                    nodeId: result.nodeId,
                    output: result.output,
                    error: result.error,
                    status: result.status
                });
                
                commandResult.summary.total++;
                if (result.status === 'SUCCESS') {
                    commandResult.summary.successful++;
                } else {
                    commandResult.summary.failed++;
                }
            }
        });

        // Convert to array
        Object.values(commandsById).forEach(cmd => {
            commandResults.push(cmd);
        });

        // Calculate overall statistics
        const totalCommands = commandResults.length;
        const successfulCommands = commandResults.filter(cmd => cmd.summary.successful > 0).length;
        const failedCommands = commandResults.filter(cmd => cmd.summary.failed > 0).length;

        logSSHOperation('info', 'SSH command execution completed', {
            projectId: projectId,
            environment: environment,
            userId: userId,
            totalCommands: totalCommands,
            successfulCommands: successfulCommands,
            failedCommands: failedCommands,
            successRate: totalCommands > 0 ? (successfulCommands / totalCommands * 100).toFixed(2) + '%' : '0%',
            timestamp: new Date().toISOString()
        });

        return {
            timestamp: new Date().toISOString(),
            results: commandResults
        };
    }

    /**
     * Execute SSH commands on a specific node
     * @param {Object} magentoCloud - Magento Cloud adapter instance
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {string} nodeId - Node ID
     * @param {Array} commands - Array of commands
     * @param {boolean} isSingleNode - Whether this is a single node execution
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Array} - Node execution results
     */
    async executeSSHCommandsOnNode(magentoCloud, projectId, environment, nodeId, commands, isSingleNode, apiToken, userId) {
        try {
            logSSHOperation('info', 'Starting SSH command execution on node', {
                projectId: projectId,
                environment: environment,
                nodeId: isSingleNode ? 'single-node' : nodeId,
                isSingleNode: isSingleNode,
                commandCount: commands.length,
                commands: commands.map(cmd => ({ id: cmd.id, title: cmd.title })),
                userId: userId,
                timestamp: new Date().toISOString()
            });

            // Create the script content with all commands.
            const scriptContent = this.createScriptContent(commands);

            // Use a here-document to pass the script to `bash -s` via SSH.
            const sshPrefix = isSingleNode
                ? `ssh -p ${projectId} -e ${environment}`
                : `ssh -p ${projectId} -e ${environment} --instance ${nodeId}`;

            const sshCommand = `${sshPrefix} "bash -s" <<'MAGENTO_SCRIPT'
${scriptContent}
MAGENTO_SCRIPT`;

            logSSHOperation('debug', 'Prepared SSH command with here-document', {
                projectId: projectId,
                environment: environment,
                nodeId: isSingleNode ? 'single-node' : nodeId,
                sshPrefix: sshPrefix,
                scriptLength: scriptContent.length,
                commandCount: commands.length,
                userId: userId,
                timestamp: new Date().toISOString()
            });

            const { stdout, stderr } = await this.executeWithRetry(
                magentoCloud,
                sshCommand,
                apiToken,
                userId,
                { maxRetries: 3, delay: 1000 }
            );

            const output = stdout + stderr;
            
            logSSHOperation('debug', 'SSH command execution completed', {
                projectId: projectId,
                environment: environment,
                nodeId: isSingleNode ? 'single-node' : nodeId,
                outputLength: output.length,
                stdoutLength: stdout.length,
                stderrLength: stderr.length,
                userId: userId,
                timestamp: new Date().toISOString()
            });
            
            const results = this.parseCommandOutput(output, commands).map(result => ({
                ...result,
                nodeId: isSingleNode ? 'single-node' : nodeId
            }));

            // Log parsing results
            const successCount = results.filter(r => r.status === 'SUCCESS').length;
            const errorCount = results.filter(r => r.status === 'ERROR').length;
            
            logSSHOperation('info', 'SSH command parsing completed', {
                projectId: projectId,
                environment: environment,
                nodeId: isSingleNode ? 'single-node' : nodeId,
                totalCommands: commands.length,
                successCount: successCount,
                errorCount: errorCount,
                userId: userId,
                timestamp: new Date().toISOString()
            });

            return results;
        } catch (error) {
            logSSHOperation('error', 'SSH command execution failed on node', {
                projectId: projectId,
                environment: environment,
                nodeId: isSingleNode ? 'single-node' : nodeId,
                errorMessage: error.message,
                errorCode: error.code,
                userId: userId,
                timestamp: new Date().toISOString()
            });

            return commands.map(cmd => ({
                commandId: cmd.id,
                nodeId: isSingleNode ? 'single-node' : nodeId,
                output: null,
                error: error.message,
                status: "ERROR"
            }));
        }
    }

    /**
     * Execute SQL queries with different strategies
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {Array} queries - Array of SQL queries
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Array} - Query execution results
     */
    async executeSQLQueries(projectId, environment, queries, apiToken, userId) {
        try {
            const magentoCloud = new MagentoCloudAdapter();
            await magentoCloud.validateExecutable();

            // Get all nodes first
            const nodes = await getNodes(projectId, environment, apiToken, userId);
            if (!nodes || nodes.length === 0) {
                throw new Error('No nodes found in the environment');
            }

            const results = [];
            const multiNodeQueries = queries.filter(q => q.executeOnAllNodes);
            const singleNodeQueries = queries.filter(q => !q.executeOnAllNodes);

            // Handle queries that should run through tunnel
            if (singleNodeQueries.length > 0) {
                // Ensure tunnel is open and get connection info
                const tunnelInfo = await tunnelManager.getServiceTunnelInfo(projectId, environment, 'database', apiToken, userId);
                const sqlService = new SQLService(tunnelInfo);

                // Format tunnel query results to match the structure of multi-node results
                for (const query of singleNodeQueries) {
                    const queryResult = {
                        id: query.id,
                        title: query.title,
                        query: query.query,
                        results: [],
                        allowAi: query.allowAi,
                        summary: {
                            total: 1,
                            successful: 0,
                            notRunning: 0,
                            failed: 0
                        }
                    };

                    try {
                        logger.debug('Executing query through tunnel');
                        const result = await sqlService.executeQuery(query.query, false);
                        queryResult.results.push({
                            nodeId: 'tunnel',
                            output: result,
                            error: null,
                            status: 'SUCCESS'
                        });
                        queryResult.summary.successful = 1;
                    } catch (error) {
                        logger.error('Tunnel query execution failed:', {
                            error: error.message,
                            query: query.title
                        });
                        queryResult.results.push({
                            nodeId: 'tunnel',
                            output: null,
                            error: error.message,
                            status: 'ERROR'
                        });
                        queryResult.summary.failed = 1;
                    }

                    results.push(queryResult);
                }
            }

            // Handle queries that should run on all nodes via SSH
            if (multiNodeQueries.length > 0) {
                // Execute queries on all nodes in parallel
                const nodePromises = nodes.map(node =>
                    this.executeQueriesOnNode(
                        magentoCloud,
                        projectId,
                        environment,
                        node.id,
                        multiNodeQueries,
                        apiToken,
                        userId
                    )
                );

                const nodeResults = await Promise.all(nodePromises);
                const flattenedResults = nodeResults.flat();

                // Group results by query
                multiNodeQueries.forEach(query => {
                    results.push({
                        id: query.id,
                        title: query.title,
                        query: query.query,
                        allowAi: query.allowAi,
                        results: flattenedResults.filter(r => r.queryId === query.id),
                        summary: {
                            total: nodes.length,
                            successful: flattenedResults.filter(r => r.queryId === query.id && r.status === 'SUCCESS').length,
                            notRunning: flattenedResults.filter(r => r.queryId === query.id && r.status === 'NOT_RUNNING').length,
                            failed: flattenedResults.filter(r => r.queryId === query.id && r.status === 'ERROR').length
                        }
                    });
                });
            }

            return results;
        } catch (error) {
            logger.error('Query execution strategy failed:', {
                error: error.message,
                projectId,
                environment,
                userId
            });
            throw error;
        }
    }

    /**
     * Execute Redis commands
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {Array} queries - Array of Redis commands
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Object} - Redis execution results
     */
    async executeRedisCommands(projectId, environment, queries, apiToken, userId) {
        // Get Redis-specific tunnel info
        const tunnelInfo = await tunnelManager.getServiceTunnelInfo(projectId, environment, 'redis', apiToken, userId);

        if (!tunnelInfo) {
            logger.error('Failed to retrieve tunnel information for Redis', {
                projectId,
                environment,
                userId
            });
            throw new Error('Failed to retrieve tunnel information');
        }

        const redisService = new RedisCliService(tunnelInfo);
        const results = [];

        for (const query of queries) {
            const queryResult = {
                id: query.id,
                title: query.title,
                query: query.query,
                results: [],
                allowAi: query.allowAi,
            };

            try {
                const output = await redisService.executeCommand(query.query);
                queryResult.results.push({
                    nodeId: 'tunnel',
                    output,
                    error: null,
                    status: 'SUCCESS'
                });
            } catch (error) {
                logger.error('Redis query execution failed:', {
                    error: error.message,
                    query: query.title,
                    projectId,
                    environment,
                    userId
                });
                queryResult.results.push({
                    nodeId: 'tunnel',
                    output: null,
                    error: error.message,
                    status: 'ERROR'
                });
            }

            queryResult.summary = {
                total: queryResult.results.length,
                successful: queryResult.results.filter(r => r.status === 'SUCCESS').length,
                failed: queryResult.results.filter(r => r.status === 'ERROR').length
            };

            results.push(queryResult);
        }

        return {
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            results
        };
    }

    /**
     * Execute Bash commands
     * @param {Array} commands - Array of Bash commands
     * @param {string} userId - User ID
     * @param {Object} context - Execution context
     * @param {string} apiToken - API token for environment setup
     * @returns {Array} - Bash execution results
     */
    async executeBashCommands(commands, userId, context, apiToken) {
        const results = [];

        for (const cmd of commands) {
            try {
                const userHomeDir = this.generateUserHomeDir(userId);
                
                // Replace placeholders in the command
                const processedCommand = this.replacePlaceholders(cmd.command, context);
                
                // Log placeholder replacement for debugging
                if (cmd.command !== processedCommand) {
                    logger.debug('Bash command placeholder replacement', {
                        userId,
                        originalCommand: cmd.command,
                        processedCommand,
                        projectId: context.projectId,
                        environment: context.environment
                    });
                }

                const { stdout, stderr } = await execAsync(processedCommand, {
                    maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                    env: {
                        ...process.env, // Inherit existing environment variables
                        MAGENTO_CLOUD_CLI_TOKEN: apiToken,
                        MAGENTO_CLOUD_HOME: userHomeDir,
                        // Add magento-cloud resources directory to PATH
                        PATH: `${path.dirname(paths.resources.magentoCloud)}:${process.env.PATH}`
                    }
                });

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

            } catch (error) {
                logger.error('Bash command execution failed:', {
                    error: error.message,
                    command: cmd.title,
                    userId,
                    projectId: context.projectId,
                    environment: context.environment
                });

                results.push({
                    id: cmd.id,
                    title: cmd.title,
                    command: cmd.command,
                    allowAi: cmd.allowAi,
                    results: [{
                        nodeId: 'bash',
                        output: null,
                        error: error.message,
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

        return {
            timestamp: new Date().toISOString(),
            results
        };
    }

    // Helper methods for SSH execution
    createScriptContent(commands) {
        return commands.map(cmd => {
            const startMarker = `ACCS_CMD_START_${cmd.id}_${Date.now()}`;
            const endMarker = `ACCS_CMD_END_${cmd.id}`;
            const errorMarker = `ACCS_CMD_ERROR_${cmd.id}`;

            const trimmedCommand = cmd.command.trim();

            return `echo "${startMarker}";
${trimmedCommand};
if [ $? -ne 0 ]; then echo "${errorMarker}"; fi;
echo "${endMarker}";
`;
        }).join('\n');
    }

    parseCommandOutput(output, commands) {
        const results = [];

        commands.forEach(cmd => {
            const startMarker = `ACCS_CMD_START_${cmd.id}`;
            const endMarker = `ACCS_CMD_END_${cmd.id}`;
            const errorMarker = `ACCS_CMD_ERROR_${cmd.id}`;

            const regex = new RegExp(`${startMarker}_\\d+([\\s\\S]*?)${endMarker}`, 'g');
            let match;
            let foundMatch = false;

            while ((match = regex.exec(output)) !== null) {
                foundMatch = true;
                const commandOutputWithMeta = match[1];
                const hasError = commandOutputWithMeta.includes(errorMarker);
                const finalOutput = commandOutputWithMeta.replace(errorMarker, '').trim();

                results.push({
                    commandId: cmd.id,
                    output: finalOutput,
                    error: hasError ? 'Command executed with a non-zero exit code.' : null,
                    status: hasError ? "ERROR" : "SUCCESS"
                });
            }

            if (!foundMatch) {
                results.push({
                    commandId: cmd.id,
                    output: null,
                    error: `Command output not found. Delimiter markers were not present in the final output.`,
                    status: "ERROR"
                });
            }
        });

        return results;
    }

    async executeWithRetry(magentoCloud, command, apiToken, userId, options = { maxRetries: 3, delay: 1000 }) {
        let lastError;

        for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
            try {
                logSSHOperation('debug', `Attempting SSH command execution (attempt ${attempt}/${options.maxRetries})`, {
                    command: command,
                    attempt: attempt,
                    maxRetries: options.maxRetries,
                    userId: userId,
                    timestamp: new Date().toISOString()
                });

                const result = await magentoCloud.executeCommand(command, apiToken, userId);
                
                if (attempt > 1) {
                    logSSHOperation('info', 'SSH command succeeded after retry', {
                        command: command,
                        attempt: attempt,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    logSSHOperation('debug', 'SSH command executed successfully on first attempt', {
                        command: command,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                }
                
                return result;
            } catch (error) {
                lastError = error;
                const isAuthError = error.message.includes('SSH certificate authentication is required') ||
                    error.message.includes('Access denied') ||
                    error.message.includes('authentication failures');

                logSSHOperation('warn', `SSH command execution failed (attempt ${attempt}/${options.maxRetries})`, {
                    command: command,
                    attempt: attempt,
                    maxRetries: options.maxRetries,
                    userId: userId,
                    errorMessage: error.message,
                    errorCode: error.code,
                    isAuthError: isAuthError,
                    stderr: error.stderr ? error.stderr.substring(0, 500) : null,
                    stdout: error.stdout ? error.stdout.substring(0, 500) : null,
                    timestamp: new Date().toISOString()
                });

                if (!isAuthError) throw error;

                if (attempt < options.maxRetries) {
                    logSSHOperation('info', `Retrying SSH command in ${options.delay}ms due to authentication error`, {
                        command: command,
                        attempt: attempt,
                        nextAttempt: attempt + 1,
                        delay: options.delay,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, options.delay));
                }
            }
        }

        logSSHOperation('error', 'SSH command failed after all retry attempts', {
            command: command,
            maxRetries: options.maxRetries,
            userId: userId,
            finalError: lastError.message,
            timestamp: new Date().toISOString()
        });

        throw lastError;
    }

    // Helper methods for SQL execution
    async executeQueriesOnNode(magentoCloud, projectId, environment, nodeId, queries, apiToken, userId) {
        try {
            const mysqlCommand = this.createMySQLCommand(queries);
            const sshCommand = `ssh -p ${projectId} -e ${environment} --instance ${nodeId} ${mysqlCommand}`;

            logger.debug('Executing SSH command:', {
                nodeId,
                queries: queries.map(q => q.title)
            });

            const { stdout, stderr } = await magentoCloud.executeCommand(sshCommand, apiToken, userId);

            if (stderr.includes('MySQL is not running on this node')) {
                return queries.map(query => ({
                    queryId: query.id,
                    nodeId,
                    output: null,
                    error: 'MySQL is not running on this node',
                    status: 'NOT_RUNNING'
                }));
            }

            const results = this.parseQueryOutput(stdout + stderr, queries);
            return results.map(result => ({
                ...result,
                nodeId,
                status: result.error ? 'ERROR' : 'SUCCESS'
            }));
        } catch (error) {
            const errorMessage = error.message.includes('ERROR 2002') ?
                'MySQL is not running on this node' : error.message;
            const status = error.message.includes('ERROR 2002') ?
                'NOT_RUNNING' : 'ERROR';

            logger.error('Node query execution failed:', {
                nodeId,
                error: errorMessage
            });

            return queries.map(query => ({
                queryId: query.id,
                nodeId,
                output: null,
                error: errorMessage,
                status
            }));
        }
    }

    createMySQLCommand(queries) {
        const mysqlScript = `
username=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].username')
password=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].password')
database=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].path')
host=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].host')

if ! mysqladmin ping -h"$host" -P3307 -u"$username" -p"$password" --connect_timeout=10 >/dev/null 2>&1; then
    echo "MySQL is not running on this node"
    exit 1
fi

${this.bundleQueries(queries)} | mysql -u"$username" -p"$password" -D"$database" -h"$host" -P3307
`.trim();

        const escapedScript = mysqlScript
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$');

        return `"bash -c \\"${escapedScript}\\""`;
    }

    bundleQueries(queries) {
        return queries.map(q => {
            const escapedQuery = q.query.replace(/'/g, "'\\''");
            return `echo 'id: ${q.id}' && echo 'title: ${q.title}' && echo '${escapedQuery}' | mysql`;
        }).join(' && ');
    }

    parseQueryOutput(output, queries) {
        const results = [];
        const lines = output.split('\n');
        let currentQuery = null;
        let currentOutput = [];

        for (let line of lines) {
            if (line.startsWith('id: ')) {
                if (currentQuery) {
                    results.push({
                        queryId: currentQuery.id,
                        output: currentOutput.join('\n').trim(),
                        error: null,
                        status: currentOutput.join('\n').trim() ? "SUCCESS" : "ERROR"
                    });
                    currentOutput = [];
                }
                const id = parseInt(line.substring(4));
                currentQuery = queries.find(q => q.id === id);
                continue;
            }
            if (line.startsWith('title: ')) {
                continue;
            }
            if (currentQuery) {
                currentOutput.push(line);
            }
        }

        if (currentQuery) {
            results.push({
                queryId: currentQuery.id,
                output: currentOutput.join('\n').trim(),
                error: null,
                status: currentOutput.join('\n').trim() ? "SUCCESS" : "ERROR"
            });
        }

        return results;
    }

    // Helper methods for Bash execution
    replacePlaceholders(command, context) {
        let processedCommand = command;
        
        // Replace project and environment placeholders
        processedCommand = processedCommand.replace(/:projectid/g, context.projectId);
        processedCommand = processedCommand.replace(/:environment/g, context.environment);
        
        // Replace instance placeholder if provided
        if (context.instance) {
            processedCommand = processedCommand.replace(/:instanceid/g, context.instance);
        }
        
        return processedCommand;
    }

    generateUserHomeDir(userId) {
        // Generate a consistent home directory for the user
        return `/tmp/user_${userId}`;
    }

    /**
     * Execute RabbitMQ commands
     * @param {string} projectId - Project ID
     * @param {string} environment - Environment name
     * @param {Array} commands - Array of RabbitMQ commands
     * @param {string} apiToken - API token
     * @param {string} userId - User ID
     * @returns {Object} - RabbitMQ execution results
     */
    async executeRabbitMQCommands(projectId, environment, commands, apiToken, userId) {
        try {
            // Initialize RabbitMQAdminService with projectId, environment, and apiToken
            const rabbitmqService = new RabbitMQAdminService(projectId, environment, apiToken, userId);
            const results = [];

            for (const command of commands) {
                const commandResult = {
                    id: command.id,
                    title: command.title,
                    command: command.command,
                    results: [],
                    allowAi: command.allowAi
                };

                try {
                    const output = await rabbitmqService.executeCommand(command.command);
                    commandResult.results.push({
                        nodeId: 'single-node', // Update as needed for your use case
                        output,
                        error: null,
                        status: 'SUCCESS'
                    });
                } catch (error) {
                    this.logger.error('RabbitMQ command execution failed:', {
                        error: error.message,
                        command: command.title
                    });
                    commandResult.results.push({
                        nodeId: 'single-node', // Update as needed for your use case
                        output: null,
                        error: error.message,
                        status: 'ERROR'
                    });
                }

                commandResult.summary = {
                    total: commandResult.results.length,
                    successful: commandResult.results.filter(r => r.status === 'SUCCESS').length,
                    failed: commandResult.results.filter(r => r.status === 'ERROR').length
                };

                results.push(commandResult);
            }

            return {
                projectId,
                environment,
                timestamp: new Date().toISOString(),
                results
            };
        } catch (error) {
            this.logger.error('RabbitMQ command execution failed:', {
                error: error.message,
                projectId,
                environment,
                userId
            });
            throw error;
        }
    }
}
