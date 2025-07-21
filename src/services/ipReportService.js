import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';

class IpReportService {
    constructor() {
        this.logger = logger;
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
     * @returns {Object} IP report data
     */
    async generateIpReport(projectId, environment, options = {}, apiToken, userId) {
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
            const nodes = await this.getEnvironmentNodes(projectId, environment, apiToken, userId);
            this.logger.info(`[IP REPORT] Found ${nodes.length} nodes: ${nodes.join(', ')}`);

            // Step 2: Collect access logs from all nodes
            this.logger.info(`[IP REPORT] Collecting access logs from all nodes`);
            const allLogs = await this.collectAccessLogs(projectId, environment, nodes, apiToken, userId);
            this.logger.info(`[IP REPORT] Collected ${allLogs.length} log lines`);

            // Step 3: Parse and filter logs based on time criteria
            this.logger.info(`[IP REPORT] Parsing and filtering logs`);
            const filteredLogs = this.parseAndFilterLogs(allLogs, { from, to, timeframe });
            this.logger.info(`[IP REPORT] Filtered to ${filteredLogs.length} relevant log entries`);

            // Step 4: Aggregate data by IP
            this.logger.info(`[IP REPORT] Aggregating data by IP`);
            const aggregatedData = this.aggregateByIp(filteredLogs);
            
            // Step 5: Sort and limit results
            const topIpData = this.getTopIps(aggregatedData, topIps);
            
            const processingTime = Date.now() - startTime;
            this.logger.info(`[IP REPORT] Report generated successfully in ${processingTime}ms`);

            return {
                success: true,
                data: {
                    summary: {
                        totalRequests: filteredLogs.length,
                        uniqueIps: Object.keys(aggregatedData).length,
                        topIpsShown: topIpData.length,
                        timeRange: this.getTimeRangeInfo(from, to, timeframe),
                        processingTimeMs: processingTime
                    },
                    ips: topIpData
                }
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.logger.error(`[IP REPORT] Failed to generate report after ${processingTime}ms:`, error);
            
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

            // Parse the output to extract node names (first column)
            const nodes = stdout
                .split('\n')
                .filter(line => line.trim())
                .map(line => line.split(/\s+/)[0])
                .filter(node => node && !node.includes('NODE'));

            return nodes;
        } catch (error) {
            this.logger.error(`[IP REPORT] Error getting nodes:`, error);
            throw error;
        }
    }

    /**
     * Collect access logs from all nodes
     */
    async collectAccessLogs(projectId, environment, nodes, apiToken, userId) {
        try {
            const magentoCloud = new MagentoCloudAdapter();
            await magentoCloud.validateExecutable();
            
            const allLogs = [];
            
            for (const node of nodes) {
                this.logger.info(`[IP REPORT] Collecting logs from node: ${node}`);
                
                // SSH to the node and collect access logs
                const command = `ssh -p ${projectId} -e ${environment} ${node} "
                    for f in /var/log/platform/*/access.log*; do
                        case \\"\\$f\\" in 
                            *.gz) gzip -cd -- \\"\\$f\\";;
                            *) cat -- \\"\\$f\\";;
                        esac
                    done
                "`;
                
                const { stdout, stderr } = await magentoCloud.executeCommand(command, apiToken, userId);
                
                if (!stderr && stdout) {
                    const nodeLines = stdout.split('\n').filter(line => line.trim());
                    allLogs.push(...nodeLines);
                    this.logger.info(`[IP REPORT] Collected ${nodeLines.length} lines from ${node}`);
                } else {
                    this.logger.warn(`[IP REPORT] No logs or error collecting from ${node}: ${stderr || 'No output'}`);
                }
            }

            return allLogs;
        } catch (error) {
            this.logger.error(`[IP REPORT] Error collecting access logs:`, error);
            throw error;
        }
    }

    /**
     * Parse and filter logs based on time criteria
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