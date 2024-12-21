'use strict';

import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { execute as getNodes } from './nodes.js';
import { tunnelManager } from '../../services/tunnelService.js';
import { SQLService } from '../../services/sqlService.js';

// Bundle multiple queries into a single MySQL command
function bundleQueries(queries) {
    return queries.map(q => {
        const escapedQuery = q.query.replace(/'/g, "'\\''");
        return `echo 'id: ${q.id}' && echo 'title: ${q.title}' && echo '${escapedQuery}' | mysql`;
    }).join(' && ');
}

// Parse output from bundled queries back into individual results
function parseQueryOutput(output, queries) {
    const results = [];
    const lines = output.split('\n');
    let currentQuery = null;
    let currentOutput = [];

    for (let line of lines) {
        if (line.startsWith('id: ')) {
            // Save previous query's output if exists
            if (currentQuery) {
                results.push({
                    queryId: currentQuery.id,
                    output: currentOutput.join('\n').trim(),
                    error: null,
                    status: currentOutput.join('\n').trim() ? "SUCCESS" : "ERROR"
                });
                currentOutput = [];
            }
            // Start new query
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

    // Don't forget the last query
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

// Create MySQL command for SSH execution
function createMySQLCommand(queries) {
    // First create a script to extract credentials and run MySQL
    const mysqlScript = `
username=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].username')
password=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].password')
database=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].path')
host=$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].host')

# Try to connect to MySQL and execute queries
if ! mysqladmin ping -h"$host" -P3307 -u"$username" -p"$password" --connect_timeout=10 >/dev/null 2>&1; then
    echo "MySQL is not running on this node"
    exit 1
fi

${bundleQueries(queries)} | mysql -u"$username" -p"$password" -D"$database" -h"$host" -P3307
`.trim();

    // Escape the script for SSH command
    const escapedScript = mysqlScript
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$');

    return `"bash -c \\"${escapedScript}\\""`;
}

// Execute queries on a specific node via SSH
async function executeQueriesOnNode(magentoCloud, projectId, environment, nodeId, queries) {
    try {
        const mysqlCommand = createMySQLCommand(queries);
        const sshCommand = `ssh -p ${projectId} -e ${environment} --instance ${nodeId} ${mysqlCommand}`;

        logger.debug('Executing SSH command:', {
            nodeId,
            queries: queries.map(q => q.title)
        });

        const { stdout, stderr } = await magentoCloud.executeCommand(sshCommand);

        // Check if MySQL is not running
        if (stderr.includes('MySQL is not running on this node')) {
            return queries.map(query => ({
                queryId: query.id,
                nodeId,
                output: null,
                error: 'MySQL is not running on this node',
                status: 'NOT_RUNNING'
            }));
        }

        const results = parseQueryOutput(stdout + stderr, queries);
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

// Validate query structure and uniqueness
function validateQueries(queries) {
    if (!Array.isArray(queries) || queries.length === 0) {
        return {
            valid: false,
            errors: ['Queries must be a non-empty array']
        };
    }

    const validationErrors = [];
    const seenIds = new Set();

    queries.forEach((query, index) => {
        if (!query.id) validationErrors.push(`Query at index ${index} is missing 'id'`);
        if (!query.title) validationErrors.push(`Query at index ${index} is missing 'title'`);
        if (!query.query) validationErrors.push(`Query at index ${index} is missing 'query'`);
        if (typeof query.executeOnAllNodes !== 'boolean') {
            validationErrors.push(`Query at index ${index} is missing 'executeOnAllNodes' or it's not a boolean`);
        }

        if (query.id) {
            if (seenIds.has(query.id)) {
                validationErrors.push(`Duplicate query ID found: ${query.id}`);
            } else {
                seenIds.add(query.id);
            }
        }

        if (query.query && typeof query.query === 'string') {
            if (query.query.trim().length === 0) {
                validationErrors.push(`Query at index ${index} has empty query string`);
            }
        }
    });

    return {
        valid: validationErrors.length === 0,
        errors: validationErrors
    };
}

// Main function to execute queries with different strategies
async function executeQueriesWithStrategy(projectId, environment, queries) {
    try {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        // Get all nodes first
        const nodes = await getNodes(projectId, environment);
        if (!nodes || nodes.length === 0) {
            throw new Error('No nodes found in the environment');
        }

        const results = [];
        const multiNodeQueries = queries.filter(q => q.executeOnAllNodes);
        const singleNodeQueries = queries.filter(q => !q.executeOnAllNodes);

        // Handle queries that should run through tunnel
        if (singleNodeQueries.length > 0) {
            // Ensure tunnel is open and get connection info
            const tunnelInfo = await tunnelManager.openTunnel(projectId, environment);
            const sqlService = new SQLService(tunnelInfo);

            // Format tunnel query results to match the structure of multi-node results
            for (const query of singleNodeQueries) {
                const queryResult = {
                    id: query.id,
                    title: query.title,
                    query: query.query,
                    results: [], // Add the extra "results" array
                    summary: {  // Add the "summary" object
                        total: 1, // Always 1 for single-node queries
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
                    queryResult.summary.successful = 1; // Update summary
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
                    queryResult.summary.failed = 1; // Update summary
                }

                results.push(queryResult);
            }
        }

        // Handle queries that should run on all nodes via SSH (no changes needed here)
        if (multiNodeQueries.length > 0) {
            // Execute queries on all nodes in parallel
            const nodePromises = nodes.map(node =>
                executeQueriesOnNode(
                    magentoCloud,
                    projectId,
                    environment,
                    node.id,
                    multiNodeQueries
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
            environment
        });
        throw error;
    }
}

// Main API handler for executing SQL queries
async function runQueries(req, res) {
    const { projectId, environment } = req.params;
    const { queries } = req.body;

    // Validate queries
    const validation = validateQueries(queries);
    if (!validation.valid) {
        return res.status(400).json({
            error: 'Invalid query format',
            details: validation.errors
        });
    }

    try {
        const results = await executeQueriesWithStrategy(projectId, environment, queries);

        res.json({
            projectId,
            environment,
            timestamp: new Date().toISOString(),
            results
        });
    } catch (error) {
        logger.error('Query execution failed:', {
            error: error.message,
            projectId,
            environment
        });

        const statusCode = error.message.includes('authentication') ? 401
            : error.message.includes('No nodes found') ? 404
                : 500;

        res.status(statusCode).json({
            error: 'Query execution failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

export { runQueries };