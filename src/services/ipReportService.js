import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

class IpReportService {
    constructor() {
        this.logger = logger;
    }

    /**
     * Send progress update via WebSocket
     */
    sendProgress(wsService, userId, message) {
        if (global.wss && userId) {
            try {
                const progressMessage = {
                    type: 'ip-report-progress',
                    message: message,
                    timestamp: new Date().toISOString()
                };
                
                // Send to all connections for this user
                global.wss.clients.forEach(client => {
                    if (client.readyState === 1 && client.userID === userId) { // WebSocket.OPEN
                        client.send(JSON.stringify(progressMessage));
                    }
                });
            } catch (error) {
                this.logger.warn(`[IP REPORT] Failed to send WebSocket progress: ${error.message}`);
            }
        }
    }

    /**
     * Generate IP access report for a given project and environment
     * @param {string} projectId - Magento Cloud project ID
     * @param {string} environment - Environment name (e.g., 'production', 'staging')
     * @param {Object} options - Report options
     * @param {string} options.from - Start time (ISO string, epoch, or relative)
     * @param {string} options.to - End time (ISO string, epoch, or relative)
     * @param {number} options.timeframe - Minutes from now (if from/to not specified)
     * @param {number} options.topIps - Number of top IPs to return (default: 20)
     * @param {string} apiToken - API token for authentication
     * @param {string} userId - User ID for logging
     * @param {Object} wsService - WebSocket service for progress updates
     * @returns {Object} IP report data
     */
    async generateIpReport(projectId, environment, options = {}, apiToken, userId, wsService = null) {
        const startTime = Date.now();
        
        try {
            this.logger.info(`[IP REPORT] Starting IP report generation for ${projectId}/${environment}`);
            
            const {
                from = null,
                to = null,
                timeframe = 60,
                topIps = 20
            } = options;

            // Step 1: Get all nodes for the environment
            this.logger.info(`[IP REPORT] Getting nodes for ${projectId}/${environment}`);
            this.sendProgress(wsService, userId, 'Getting available nodes...');
            
            const nodes = await this.getEnvironmentNodes(projectId, environment, apiToken, userId);
            this.logger.info(`[IP REPORT] Found ${nodes.length} nodes: ${nodes.join(', ')}`);
            this.sendProgress(wsService, userId, `Found ${nodes.length} nodes`);

            // Step 2: Collect access logs from all nodes
            this.logger.info(`[IP REPORT] Collecting access logs from all nodes`);
            const allLogs = await this.collectAccessLogs(projectId, environment, nodes, apiToken, userId, wsService);
            this.logger.info(`[IP REPORT] Collected ${allLogs.length} log lines`);

            // Step 3: Parse logs (time filtering already done server-side)
            this.logger.info(`[IP REPORT] Parsing logs`);
            this.sendProgress(wsService, userId, 'Aggregating locally...');
            
            const parsedLogs = this.parseLogLines(allLogs);
            this.logger.info(`[IP REPORT] Parsed ${parsedLogs.length} relevant log entries`);

            // Step 4: Aggregate data by IP
            this.logger.info(`[IP REPORT] Aggregating data by IP`);
            const aggregatedData = this.aggregateByIp(parsedLogs);
            
            // Step 5: Sort and limit results
            const topIpData = this.getTopIps(aggregatedData, topIps);
            
            const processingTime = Date.now() - startTime;
            this.logger.info(`[IP REPORT] Report generated successfully in ${processingTime}ms`);

            // Format output exactly like bash script
            const formattedOutput = this.formatOutputLikeBashScript(topIpData);
            
            return {
                success: true,
                data: {
                    summary: {
                        totalRequests: parsedLogs.length,
                        uniqueIps: Object.keys(aggregatedData).length,
                        topIpsShown: topIpData.length,
                        timeRange: this.getTimeRangeInfo(from, to, timeframe),
                        processingTimeMs: processingTime
                    },
                    ips: topIpData,
                    rawOutput: formattedOutput, // Raw format like bash script
                    reportId: `${projectId}-${environment}-${Date.now()}` // For caching
                }
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.logger.error(`[IP REPORT] Failed to generate report after ${processingTime}ms:`, error);
            console.error('[IP REPORT] Service error:', error);
            
            return {
                success: false,
                error: error.message,
                processingTimeMs: processingTime
            };
        }
    }

    /**
     * Get all nodes for a specific environment
     */
    async getEnvironmentNodes(projectId, environment, apiToken, userId) {
        try {
            const magentoCloud = new MagentoCloudAdapter();
            await magentoCloud.validateExecutable();

            // Use magento-cloud ssh command to get all nodes
            const command = `ssh -p ${projectId} -e ${environment} --all`;
            const { stdout, stderr } = await magentoCloud.executeCommand(command, apiToken, userId);
            
            if (stderr) {
                throw new Error(`Failed to get nodes: ${stderr}`);
            }

            // Parse the output to extract SSH connection strings
            // The output contains SSH connection strings like: 1.ent-...-production-...@ssh.us-4.magento.cloud
            this.logger.info(`[IP REPORT] Raw ssh --all output: ${stdout}`);
            
            const lines = stdout.split('\n').filter(line => line.trim());
            this.logger.info(`[IP REPORT] Filtered lines: ${JSON.stringify(lines)}`);
            
            // Extract the full SSH connection strings (these ARE the nodes)
            const nodes = lines
                .map(line => line.split(/\s+/)[0])
                .filter(node => node && node.includes('@ssh.'));
            
            this.logger.info(`[IP REPORT] Parsed SSH connection strings: ${JSON.stringify(nodes)}`);
            
            if (nodes.length === 0) {
                throw new Error(`No valid SSH connections found in ssh --all output: ${stdout}`);
            }

            return nodes;
        } catch (error) {
            this.logger.error(`[IP REPORT] Error getting nodes:`, error);
            throw error;
        }
    }

    /**
     * Collect access logs from all nodes
     */
    async collectAccessLogs(projectId, environment, nodes, apiToken, userId, wsService = null) {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const execAsync = promisify(exec);
            
            const allLogs = [];
            
            for (let i = 0; i < nodes.length; i++) {
                const sshConnection = nodes[i];
                this.logger.info(`[IP REPORT] Collecting logs from SSH connection: ${sshConnection}`);
                
                // Send progress update (matching your bash script format)
                const nodeNumber = sshConnection.split('.')[0];
                this.sendProgress(wsService, userId, `Collecting from ${nodeNumber}.${sshConnection.split('@')[1]}...`);
                
                // Calculate time filtering parameters (matching your bash script)
                const timeFilterCommand = this.buildTimeFilterCommand({ timeframe });
                
                // Direct SSH to the connection string to collect access logs
                // Match your working bash script exactly
                const sshCommand = `ssh ${sshConnection} '${timeFilterCommand}'`;
                
                this.logger.info(`[IP REPORT] Executing SSH command: ${sshCommand}`);
                
                try {
                    const { stdout, stderr } = await execAsync(sshCommand, {
                        timeout: 120000, // 2 minutes timeout
                        maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large log files
                    });
                    
                    if (stdout) {
                        const nodeLines = stdout.split('\n').filter(line => line.trim());
                        allLogs.push(...nodeLines);
                        this.logger.info(`[IP REPORT] Collected ${nodeLines.length} lines from ${sshConnection}`);
                    }
                    
                    if (stderr) {
                        this.logger.warn(`[IP REPORT] SSH stderr from ${sshConnection}: ${stderr}`);
                    }
                } catch (sshError) {
                    this.logger.error(`[IP REPORT] SSH error for ${sshConnection}:`, sshError.message);
                    // Continue with other nodes even if one fails
                }
            }

            return allLogs;
        } catch (error) {
            this.logger.error(`[IP REPORT] Error collecting access logs:`, error);
            throw error;
        }
    }

    /**
     * Parse log lines into structured data (no time filtering - done server-side)
     */
    parseLogLines(logs) {
        const parsedLogs = [];
        
        for (const line of logs) {
            if (!line.trim()) continue;
            
            try {
                const logEntry = this.parseLogLine(line);
                if (logEntry) {
                    parsedLogs.push(logEntry);
                }
            } catch (error) {
                this.logger.debug(`[IP REPORT] Error parsing log line: ${error.message}`);
                continue;
            }
        }
        
        return parsedLogs;
    }

    /**
     * Parse and filter logs based on time criteria (LEGACY - now using server-side filtering)
     */
    parseAndFilterLogs(logs, { from, to, timeframe }) {
        const filteredLogs = [];
        const monthMap = {
            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
        };

        // Determine time filtering mode and boundaries
        let fromEpoch, toEpoch, mode;
        
        if (from || to) {
            mode = 'range';
            fromEpoch = from ? this.parseTimeToEpoch(from) : 0;
            toEpoch = to ? this.parseTimeToEpoch(to) : Date.now() / 1000;
        } else if (timeframe > 0) {
            mode = 'since';
            fromEpoch = (Date.now() / 1000) - (timeframe * 60);
            toEpoch = Date.now() / 1000;
        } else {
            mode = 'none';
            fromEpoch = 0;
            toEpoch = Number.MAX_SAFE_INTEGER;
        }

        for (const line of logs) {
            if (!line.trim()) continue;

            try {
                // Parse timestamp [dd/Mon/yyyy:HH:mm:ss
                const timestampMatch = line.match(/\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
                
                if (mode !== 'none' && timestampMatch) {
                    const [, day, month, year, hour, minute, second] = timestampMatch;
                    const monthNum = monthMap[month];
                    
                    if (monthNum) {
                        const logDate = new Date(year, monthNum - 1, day, hour, minute, second);
                        const logEpoch = logDate.getTime() / 1000;
                        
                        if (logEpoch < fromEpoch || logEpoch > toEpoch) {
                            continue;
                        }
                    }
                } else if (mode !== 'none') {
                    continue; // Skip lines without proper timestamp when filtering
                }

                // Parse IP address (first field)
                const ipMatch = line.match(/^([0-9.]+)/);
                if (!ipMatch) continue;

                const logEntry = this.parseLogLine(line);
                if (logEntry) {
                    filteredLogs.push(logEntry);
                }

            } catch (error) {
                this.logger.debug(`[IP REPORT] Error parsing log line: ${error.message}`);
                continue;
            }
        }

        return filteredLogs;
    }

    /**
     * Parse a single log line into structured data
     */
    parseLogLine(line) {
        try {
            // Extract IP (first field)
            const ipMatch = line.match(/^([0-9.]+)/);
            if (!ipMatch) return null;
            const ip = ipMatch[1];

            // Extract HTTP status code
            const fields = line.split(' ');
            let status = null;
            for (let i = 1; i < fields.length; i++) {
                if (fields[i].match(/^[0-9]{3}$/) && fields[i-1].includes('HTTP')) {
                    status = parseInt(fields[i]);
                    break;
                }
            }

            // Extract HTTP method
            const methodMatch = line.match(/"([A-Z]+)\s/);
            const method = methodMatch ? methodMatch[1] : null;

            // Extract User Agent (last quoted string)
            const quotes = line.split('"');
            const userAgent = quotes.length >= 2 ? quotes[quotes.length - 2] : null;

            // Extract URL
            const urlMatch = line.match(/"[A-Z]+\s([^\s"]+)/);
            const url = urlMatch ? urlMatch[1] : null;

            return {
                ip,
                status,
                method,
                userAgent,
                url,
                originalLine: line
            };

        } catch (error) {
            this.logger.debug(`[IP REPORT] Error parsing log line: ${error.message}`);
            return null;
        }
    }

    /**
     * Aggregate log data by IP address
     */
    aggregateByIp(logs) {
        const aggregated = {};

        for (const log of logs) {
            const { ip, status, method, userAgent, url } = log;

            if (!aggregated[ip]) {
                aggregated[ip] = {
                    ip,
                    totalHits: 0,
                    statusCodes: {},
                    methods: {},
                    userAgents: {},
                    topUrls: {},
                    firstSeen: null,
                    lastSeen: null
                };
            }

            const ipData = aggregated[ip];
            ipData.totalHits++;

            // Status codes
            if (status) {
                ipData.statusCodes[status] = (ipData.statusCodes[status] || 0) + 1;
            }

            // Methods
            if (method) {
                ipData.methods[method] = (ipData.methods[method] || 0) + 1;
            }

            // User agents (keep track of most common)
            if (userAgent) {
                ipData.userAgents[userAgent] = (ipData.userAgents[userAgent] || 0) + 1;
            }

            // URLs (keep track of most accessed)
            if (url) {
                ipData.topUrls[url] = (ipData.topUrls[url] || 0) + 1;
            }
        }

        // Process each IP's data
        for (const ip in aggregated) {
            const ipData = aggregated[ip];
            
            // Get most common user agent
            ipData.primaryUserAgent = this.getMostCommon(ipData.userAgents);
            
            // Get top URLs (limit to top 5)
            ipData.topUrlsList = this.getTopEntries(ipData.topUrls, 5);
        }

        return aggregated;
    }

    /**
     * Get top IPs sorted by hit count
     */
    getTopIps(aggregatedData, limit) {
        return Object.values(aggregatedData)
            .sort((a, b) => b.totalHits - a.totalHits)
            .slice(0, limit);
    }

    /**
     * Helper function to get most common entry
     */
    getMostCommon(obj) {
        let maxCount = 0;
        let mostCommon = null;
        
        for (const [key, count] of Object.entries(obj)) {
            if (count > maxCount) {
                maxCount = count;
                mostCommon = key;
            }
        }
        
        return mostCommon;
    }

    /**
     * Helper function to get top entries
     */
    getTopEntries(obj, limit) {
        return Object.entries(obj)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([key, count]) => ({ item: key, count }));
    }

    /**
     * Parse time string to epoch timestamp
     */
    parseTimeToEpoch(timeStr) {
        try {
            // Handle epoch timestamps
            if (/^@?\d+$/.test(timeStr)) {
                return parseInt(timeStr.replace('@', ''));
            }
            
            // Handle ISO strings and other date formats
            return new Date(timeStr).getTime() / 1000;
        } catch (error) {
            this.logger.warn(`[IP REPORT] Invalid time format: ${timeStr}`);
            return Date.now() / 1000;
        }
    }

    /**
     * Build time filter command that matches the working bash script exactly
     */
    buildTimeFilterCommand(options) {
        const { timeframe = 60 } = options;
        
        if (timeframe === 0) {
            // No time filtering, all logs (only current access.log)
            return 'cat /var/log/platform/*/access.log';
        } else {
            // Server-side time filtering using gawk (exactly like your bash script)
            const currentEpoch = Math.floor(Date.now() / 1000);
            const sinceEpoch = currentEpoch - (timeframe * 60);
            
            return `
                wall_ago=${sinceEpoch}
                gawk -v WALL_AGO=$wall_ago '
                BEGIN {
                    split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec",M," ")
                    for(m=1;m<=12;m++)mon[M[m]]=m
                }
                {
                    if (match($0,/\\[([0-9]{2})\\/([A-Za-z]{3})\\/([0-9]{4}):([0-9]{2}):([0-9]{2}):([0-9]{2})/,t)) {
                        ts = mktime(t[3]" "mon[t[2]]" "t[1]" "t[4]" "t[5]" "t[6])
                        if (ts >= WALL_AGO) print $0
                    }
                }
                ' /var/log/platform/*/access.log
            `.replace(/\s+/g, ' ').trim();
        }
    }

    /**
     * Format output exactly like bash script
     */
    formatOutputLikeBashScript(topIpData) {
        const lines = [];
        
        for (const ipData of topIpData) {
            // IP line: "IP: 194.81.125.225 - Total count: 1477"
            lines.push(`IP: ${ipData.ip} - Total count: ${ipData.totalHits}`);
            
            // Status codes: "Status: 200 - Count: 1452"
            for (const [status, count] of Object.entries(ipData.statusCodes)) {
                lines.push(`Status: ${status} - Count: ${count}`);
            }
            
            // Methods: "Method: POST - Count: 1082"
            for (const [method, count] of Object.entries(ipData.methods)) {
                lines.push(`Method: ${method} - Count: ${count}`);
            }
            
            // User agents: "User agent: Mozilla/5.0 ..."
            for (const [userAgent, count] of Object.entries(ipData.userAgents)) {
                lines.push(`User agent: ${userAgent}`);
            }
            
            lines.push(''); // Empty line between IPs
        }
        
        return lines.join('\n');
    }

    /**
     * Get time range information for the report
     */
    getTimeRangeInfo(from, to, timeframe) {
        if (from || to) {
            return {
                mode: 'range',
                from: from || 'beginning',
                to: to || 'now'
            };
        } else if (timeframe > 0) {
            return {
                mode: 'since',
                timeframe: `${timeframe} minutes`,
                from: new Date(Date.now() - timeframe * 60 * 1000).toISOString()
            };
        } else {
            return {
                mode: 'all',
                description: 'All available logs'
            };
        }
    }
}

export const ipReportService = new IpReportService(); 