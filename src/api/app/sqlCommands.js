import { logger } from '../../services/logger.js';
import MagentoCloudAdapter from '../../adapters/magentoCloud.js';
import { execute as getNodes } from './nodes.js';
import { tunnelManager } from '../../services/tunnelService.js';
import { SQLService } from '../../services/sqlService.js';

// Create MySQL command for SSH access with port 3307
function createMySQLCommand(queries) {
    if (!process.env.LOCAL_MARIADB_PORT) {
        throw new Error('LOCAL_MARIADB_PORT not configured in environment');
    }

    // When escaping queries, preserve all quotes
    // Just escape any double quotes that would break the outer command
    const escapedQueries = Array.isArray(queries) 
        ? queries.map(q => q.replace(/"/g, '\\"')).join('; ')
        : queries.replace(/"/g, '\\"');

    return `"mysql -u\\$(echo \\$MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].username') \\
-p\\$(echo \\$MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].password') \\
-D\\$(echo \\$MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].path') \\
-h\\$(echo \\$MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r '.database[0].host') \\
-P${process.env.LOCAL_MARIADB_PORT} \\
-e \\"${escapedQueries}\\""`;
}

// Format query to handle LIKE clauses consistently
function formatQuery(query) {
    return query.replace(/LIKE\s+(\w+)/gi, "LIKE '$1'");
}

async function executeQueryOnNode(magentoCloud, projectId, environment, nodeId, query) {
    try {
        // Format the query before creating the MySQL command
        const formattedQuery = formatQuery(query);
        const mysqlCommand = createMySQLCommand(formattedQuery);
        const sshCommand = `ssh -p ${projectId} -e ${environment} --instance ${nodeId} ${mysqlCommand}`;

        logger.debug('Executing SSH command:', {
            command: sshCommand,
            nodeId,
            query: formattedQuery
        });

        const { stdout, stderr } = await magentoCloud.executeCommand(sshCommand);
        return {
            output: stdout ? stdout.trim() : null,
            error: null
        };
    } catch (error) {
        // Check for common expected errors
        if (error.message.includes("ERROR 2002") && error.message.includes("Can't connect to MySQL server")) {
            return {
                output: null,
                error: "Database service not running on this node",
                status: "NOT_RUNNING"
            };
        }

        logger.error('Node query execution failed:', {
            nodeId,
            error: error.message,
            query
        });
        return {
            output: null,
            error: error.message,
            status: "ERROR"
        };
    }
}

async function executeQueriesWithStrategy(projectId, environment, queries) {
    try {
        const magentoCloud = new MagentoCloudAdapter();
        await magentoCloud.validateExecutable();

        // Split queries based on execution strategy
        const multiNodeQueries = queries.filter(q => q.executeOnAllNodes);
        const singleNodeQueries = queries.filter(q => !q.executeOnAllNodes);

        const results = [];

        // Handle single node queries using tunnel
        if (singleNodeQueries.length > 0) {
            const tunnelInfo = await tunnelManager.openTunnel(projectId, environment);
            const sqlService = new SQLService(tunnelInfo);

            for (const query of singleNodeQueries) {
                const queryResult = {
                    id: query.id,
                    title: query.title,
                    query: query.query,
                    results: []
                };

                try {
                    logger.debug('Executing cluster query through tunnel');
                    // Format query consistently
                    const formattedQuery = formatQuery(query.query);
                    const result = await sqlService.executeQuery(formattedQuery, false);
                    queryResult.results.push({
                        nodeId: 1,
                        output: result,
                        error: null
                    });
                } catch (error) {
                    logger.error('Tunnel query execution failed:', {
                        error: error.message,
                        query: query.title
                    });
                    queryResult.results.push({
                        nodeId: 1,
                        output: null,
                        error: error.message
                    });
                }

                results.push(queryResult);
            }
        }

        // Handle multi-node queries using SSH
        if (multiNodeQueries.length > 0) {
            const nodes = await getNodes(projectId, environment);
            
            for (const query of multiNodeQueries) {
                const queryResult = {
                    id: query.id,
                    title: query.title,
                    query: query.query,
                    results: []
                };
    
                const nodeResults = await Promise.all(
                    nodes.map(node => 
                        executeQueryOnNode(
                            magentoCloud, 
                            projectId, 
                            environment, 
                            node.id, 
                            query.query
                        ).then(result => ({
                            nodeId: node.id,
                            output: result.output,
                            error: result.error,
                            status: result.status || (result.output ? "SUCCESS" : "ERROR"),
                            nodeType: node.type || "unknown"
                        }))
                    )
                );

                queryResult.results = nodeResults.sort((a, b) => a.nodeId - b.nodeId);

                const summary = {
                    total: queryResult.results.length,
                    successful: queryResult.results.filter(r => r.status === "SUCCESS").length,
                    notRunning: queryResult.results.filter(r => r.status === "NOT_RUNNING").length,
                    failed: queryResult.results.filter(r => r.status === "ERROR").length
                };

                results.push({
                    ...queryResult,
                    summary
                });
            }
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

export async function runQueries(req, res) {
    const { projectId, environment } = req.params;
    const { queries } = req.body;

    if (!Array.isArray(queries)) {
        return res.status(400).json({
            error: 'Invalid request format',
            details: 'Queries must be an array'
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

        const statusCode = error.message.includes('access denied') ? 401 : 500;
        res.status(statusCode).json({
            error: 'Query execution failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}