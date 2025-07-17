import yaml from 'js-yaml';
import { logger } from './logger.js';

class TraceConfig {
    constructor(options = {}) {
        this.includeFilepath = options.includeFilepath !== false;
        this.includeTimestamp = options.includeTimestamp !== false;
        this.includeDbQueries = options.includeDbQueries !== false;
        this.includeCpuMetrics = options.includeCpuMetrics !== false;
        this.includeRequestHeaders = options.includeRequestHeaders !== false;
        this.includeGuid = options.includeGuid !== false;
        this.includeDuration = options.includeDuration !== false;
        this.includeFunction = options.includeFunction !== false;
        this.includeMetadata = options.includeMetadata !== false;
    }
}

class YamlConversionService {
    constructor() {
        this.logger = logger;
    }

    formatNodeForYaml(nodeData, config) {
        const name = nodeData.name || 'Unnamed Node';
        
        // Create payload with just the name initially
        const payload = {
            name: name,
        };
        
        // Only include guid if requested
        if (config.includeGuid) {
            payload.guid = nodeData.guid || '';
        }
        
        // Only include duration if requested
        if (config.includeDuration) {
            payload.duration_us = nodeData.duration || 0;
        }
        
        const attributes = nodeData.attributesMap || {};
        
        // Include timestamp if requested
        if (config.includeTimestamp) {
            payload.timestamp_us = nodeData.timestamp || 0;
        }
        
        // Include filepath info if requested
        if (config.includeFilepath && attributes['code.filepath']) {
            const filepath = attributes['code.filepath'];
            const lineno = attributes['code.lineno'] || '';
            // Shorten the filepath to just the relevant part
            let shortenedFilepath = filepath;
            if (filepath.includes('/app/')) {
                shortenedFilepath = filepath.split('/app/')[1];
            }
            payload.file = lineno ? `${shortenedFilepath}:${lineno}` : shortenedFilepath;
        }
        
        // Include SQL queries if requested
        if (config.includeDbQueries && attributes['db.statement']) {
            let dbStatement = attributes['db.statement'];
            // Truncate very long queries
            if (dbStatement.length > 200) {
                dbStatement = dbStatement.substring(0, 197) + "...";
            }
            payload.sql = dbStatement;
        }
        
        // Include function info if requested and available
        if (config.includeFunction && attributes['code.function']) {
            payload.func = attributes['code.function'];
        }
        
        return payload;
    }

    extractHeaderInfo(traceData, config) {
        const infoLines = [];
        const agentAttrs = traceData.agentAttributes || {};
        const intrinsicAttrs = traceData.intrinsicAttributes || {};
        
        // Compact header format
        const method = agentAttrs['request.method'] || 'N/A';
        const uri = agentAttrs['request.uri'] || 'N/A';
        const status = agentAttrs['http.statusCode'] || 'N/A';
        const traceId = intrinsicAttrs.traceId || 'N/A';
        
        // Single line summary
        infoLines.push(`# ${method} ${uri} | Status: ${status} | Trace: ${traceId}`);
        
        if (config.includeRequestHeaders) {
            if (agentAttrs.SERVER_NAME) {
                infoLines.push(`# Server: ${agentAttrs.SERVER_NAME}`);
            }
        }
        
        if (config.includeCpuMetrics) {
            const totalMs = Math.round((intrinsicAttrs.totalTime || 0) * 100) / 100;
            const cpuMs = Math.round((intrinsicAttrs.cpu_time || 0) * 100) / 100;
            infoLines.push(`# Time: ${totalMs}ms (CPU: ${cpuMs}ms)`);
        }
        
        return infoLines.join('\n');
    }

    buildTraceTree(traceData, config) {
        const nodesList = traceData.nodes;
        const edgesList = traceData.edges;

        if (!nodesList || !edgesList) {
            this.logger.warn("Node or edge data is missing from the trace.");
            return [];
        }

        // 1. Create maps for quick lookups
        const rawNodesMap = {};
        nodesList.forEach(node => {
            if (node.guid) {
                rawNodesMap[node.guid] = node;
            }
        });

        const childrenMap = {};
        const parentMap = {};
        
        edgesList.forEach(edge => {
            const parentGuid = edge.parentGuid;
            const childGuid = edge.childGuid;
            if (parentGuid && childGuid) {
                if (!childrenMap[parentGuid]) {
                    childrenMap[parentGuid] = [];
                }
                childrenMap[parentGuid].push(childGuid);
                parentMap[childGuid] = parentGuid;
            }
        });

        // 2. Find root nodes
        const rootGuids = childrenMap.head || [];
        if (rootGuids.length === 0) {
            this.logger.warn("Could not find a root node with parent 'head'.");
            return [];
        }

        // 3. Create a flattened structure
        const finalTree = [];
        
        rootGuids.forEach(rootGuid => {
            if (!rawNodesMap[rootGuid]) {
                return;
            }
            
            // Create the root node
            const rootNode = this.formatNodeForYaml(rawNodesMap[rootGuid], config);
            finalTree.push(rootNode);
            
            // Build a tree using breadth-first traversal
            let currentLevel = [rootNode];
            let currentGuids = [rootGuid];
            
            while (currentLevel.length > 0) {
                const nextLevel = [];
                const nextGuids = [];
                
                currentLevel.forEach((currentNode, i) => {
                    const currentGuid = currentGuids[i];
                    const childGuids = childrenMap[currentGuid] || [];
                    
                    if (childGuids.length > 0) {
                        const childrenList = [];
                        childGuids.forEach(childGuid => {
                            if (rawNodesMap[childGuid]) {
                                // Create a completely independent child node
                                const childData = { ...this.formatNodeForYaml(rawNodesMap[childGuid], config) };
                                childrenList.push(childData);
                                nextLevel.push(childData);
                                nextGuids.push(childGuid);
                            }
                        });
                        
                        if (childrenList.length > 0) {
                            currentNode.children = childrenList;
                        }
                    }
                });
                
                currentLevel = nextLevel;
                currentGuids = nextGuids;
            }
        });

        return finalTree;
    }

    generateYamlString(tree, config) {
        const outputLines = [];
        const stack = [];
        
        // Push root nodes in reverse order for correct processing
        for (let i = tree.length - 1; i >= 0; i--) {
            stack.push([tree[i], 0]);
        }
        
        while (stack.length > 0) {
            const [node, depth] = stack.pop();
            
            // Create indent - use minimal spacing
            const indent = " ".repeat(depth * 2);
            
            // Build the node representation
            const parts = [];
            
            // Node ID (only if configured)
            if (config.includeGuid && node.guid) {
                parts.push(node.guid || '?');
            }
            
            // Duration (only if configured)
            if (config.includeDuration && node.duration_us !== undefined) {
                const duration = node.duration_us || 0;
                if (duration >= 1000) {
                    parts.push(`${Math.round(duration/1000)}ms`);
                } else {
                    parts.push(`${duration}µ`);
                }
            }
            
            // Timestamp (only if configured and > 0)
            if (config.includeTimestamp && node.timestamp_us !== undefined && node.timestamp_us > 0) {
                const ts = node.timestamp_us || 0;
                if (ts >= 1000) {
                    parts.push(`@${Math.round(ts/1000)}`);
                } else {
                    parts.push(`@${ts}`);
                }
            }
            
            // Create line start (only add separator if we have parts)
            const lineStart = parts.length > 0 ? indent + parts.join("|") + " " : indent;
            
            // Name - no abbreviations
            const name = node.name || '?';
            
            // File info - ultra compact
            let fileInfo = "";
            if (config.includeFilepath && node.file) {
                const filePath = node.file;
                // Extract just the important parts
                if (filePath.includes('/')) {
                    const fileParts = filePath.split('/');
                    if (fileParts.length > 2) {
                        // Keep vendor/module or app/code structure
                        fileInfo = ` (${fileParts[fileParts.length - 2]}/${fileParts[fileParts.length - 1]})`;
                    } else {
                        fileInfo = ` (${filePath.split('/')[filePath.split('/').length - 1]})`;
                    }
                } else {
                    fileInfo = ` (${filePath})`;
                }
            }
            
            // Function info (only if different from name)
            let funcInfo = "";
            if (config.includeFunction && node.func) {
                const func = node.func;
                if (!name.includes(func)) {  // Only show if it adds information
                    funcInfo = ` fn:${func}`;
                }
            }
            
            // SQL - truncate aggressively
            let sqlInfo = "";
            if (config.includeDbQueries && node.sql) {
                let sql = node.sql;
                if (sql.length > 50) {
                    sql = sql.substring(0, 47) + "...";
                }
                sqlInfo = ` SQL:${sql}`;
            }
            
            // Combine all parts
            outputLines.push(lineStart + name + fileInfo + funcInfo + sqlInfo);
            
            // Process children if they exist
            if (node.children && node.children.length > 0) {
                // Push children in reverse order
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push([node.children[i], depth + 1]);
                }
            }
        }
        
        return outputLines.join('\n');
    }

    convertJsonToYaml(jsonPayload, config = new TraceConfig()) {
        try {
            const trace = jsonPayload.data.actor.entity.transactionTrace;
            
            // Build the header with request info
            const header = this.extractHeaderInfo(trace, config);
            
            // Extract additional trace metadata
            const metadataLines = [];
            
            if (config.includeMetadata) {
                // Add trace-level information
                metadataLines.push("# Trace Information:");
                metadataLines.push(`#   GUID: ${trace.guid || 'N/A'}`);
                metadataLines.push(`#   Duration: ${((trace.duration || 0) / 1000).toFixed(2)}ms`);
                metadataLines.push(`#   Path: ${trace.path || 'N/A'}`);
                
                // Add agent attributes if present
                const agentAttrs = trace.agentAttributes || {};
                if (Object.keys(agentAttrs).length > 0) {
                    metadataLines.push("# Agent Attributes:");
                    const sortedKeys = Object.keys(agentAttrs).sort();
                    sortedKeys.slice(0, 10).forEach(key => {
                        const value = String(agentAttrs[key]);
                        metadataLines.push(`#   ${key}: ${value.substring(0, 100)}`);
                    });
                    if (sortedKeys.length > 10) {
                        metadataLines.push(`#   ... and ${sortedKeys.length - 10} more`);
                    }
                }
                
                // Add intrinsic attributes if present
                const intrinsicAttrs = trace.intrinsicAttributes || {};
                if (Object.keys(intrinsicAttrs).length > 0) {
                    metadataLines.push("# Intrinsic Attributes:");
                    const sortedKeys = Object.keys(intrinsicAttrs).sort();
                    sortedKeys.slice(0, 10).forEach(key => {
                        metadataLines.push(`#   ${key}: ${intrinsicAttrs[key]}`);
                    });
                    if (sortedKeys.length > 10) {
                        metadataLines.push(`#   ... and ${sortedKeys.length - 10} more`);
                    }
                }
                
                // Add user attributes if present
                const userAttrs = trace.userAttributes || {};
                if (Object.keys(userAttrs).length > 0) {
                    metadataLines.push("# User Attributes:");
                    const sortedKeys = Object.keys(userAttrs).sort();
                    sortedKeys.slice(0, 10).forEach(key => {
                        metadataLines.push(`#   ${key}: ${userAttrs[key]}`);
                    });
                    if (sortedKeys.length > 10) {
                        metadataLines.push(`#   ... and ${sortedKeys.length - 10} more`);
                    }
                }
            }
            
            // Build the trace tree
            const tree = this.buildTraceTree(trace, config);
            
            if (tree.length === 0) {
                return `${header}\n${metadataLines.join('\n')}\n---\n# No trace tree could be generated. Check that the JSON contains a valid 'nodes' and 'edges' structure with a 'head' parent.`;
            }
            
            const yamlContent = this.generateYamlString(tree, config);
            
            // Combine all parts
            let fullOutput = header;
            if (metadataLines.length > 0) {
                fullOutput += "\n" + metadataLines.join('\n');
            }
            fullOutput += "\n---\n" + yamlContent;
            
            return fullOutput;
            
        } catch (error) {
            this.logger.error('Error converting JSON to YAML:', error);
            throw new Error(`Failed to convert JSON to YAML: ${error.message}`);
        }
    }

    async convertPayload(payload, options = {}) {
        const startTime = Date.now();
        
        try {
            this.logger.info(`[YAML SERVICE] Starting payload conversion`);
            
            // Step 1: Extract trace data
            this.logger.info(`[YAML SERVICE] Extracting trace data`);
            const extractStartTime = Date.now();
            const traceData = payload.data?.actor?.entity?.transactionTrace;
            if (!traceData) {
                throw new Error('Invalid New Relic trace format: missing transactionTrace');
            }
            const extractTime = Date.now() - extractStartTime;
            this.logger.info(`[YAML SERVICE] Trace data extracted in ${extractTime}ms`);

            // Step 2: Build trace tree
            this.logger.info(`[YAML SERVICE] Building trace tree`);
            const treeStartTime = Date.now();
            const config = new TraceConfig(options);
            const tree = this.buildTraceTree(traceData, config);
            const treeTime = Date.now() - treeStartTime;
            this.logger.info(`[YAML SERVICE] Trace tree built in ${treeTime}ms with ${tree.length} root nodes`);

            // Step 3: Generate YAML string
            this.logger.info(`[YAML SERVICE] Generating YAML string`);
            const yamlStartTime = Date.now();
            const yamlString = this.generateYamlString(tree, config);
            const yamlTime = Date.now() - yamlStartTime;
            this.logger.info(`[YAML SERVICE] YAML string generated in ${yamlTime}ms`);

            // Step 4: Add header information
            this.logger.info(`[YAML SERVICE] Adding header information`);
            const headerStartTime = Date.now();
            const headerInfo = this.extractHeaderInfo(traceData, config);
            const headerTime = Date.now() - headerStartTime;
            this.logger.info(`[YAML SERVICE] Header added in ${headerTime}ms`);

            // Step 5: Combine and estimate tokens
            this.logger.info(`[YAML SERVICE] Finalizing conversion`);
            const finalStartTime = Date.now();
            const finalYaml = headerInfo + '\n\n' + yamlString;
            const tokenCount = this.estimateTokenCount(finalYaml);
            const finalTime = Date.now() - finalStartTime;
            
            const totalTime = Date.now() - startTime;
            this.logger.info(`[YAML SERVICE] Conversion completed in ${totalTime}ms total (extract: ${extractTime}ms, tree: ${treeTime}ms, yaml: ${yamlTime}ms, header: ${headerTime}ms, final: ${finalTime}ms)`);
            this.logger.info(`[YAML SERVICE] Final YAML size: ${finalYaml.length} characters, estimated tokens: ${tokenCount}`);

            return {
                success: true,
                yamlContent: finalYaml,
                tokenCount: tokenCount,
                processingTimeMs: totalTime
            };

        } catch (error) {
            const totalTime = Date.now() - startTime;
            this.logger.error(`[YAML SERVICE] Conversion failed after ${totalTime}ms:`, error);
            
            return {
                success: false,
                error: error.message,
                processingTimeMs: totalTime
            };
        }
    }

    estimateTokenCount(text) {
        // Rough estimation: 1 token ≈ 4 characters for English text
        return Math.ceil(text.length / 4);
    }
}

export default new YamlConversionService(); 