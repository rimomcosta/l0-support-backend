import { logger } from './logger.js';
import axios from 'axios';

export class NewRelicIpReportService {
    constructor() {
        this.graphqlUrl = 'https://api.newrelic.com/graphql';
        this.logger = logger;
    }

    /**
     * Get API key with lazy loading
     */
    get apiKey() {
        const key = process.env.NEWRELIC_API_KEY;
        if (!key) {
            throw new Error('NEWRELIC_API_KEY environment variable is required');
        }
        return key;
    }

    /**
     * Send progress updates via WebSocket
     */
    sendProgress(wsService, userId, message) {
        console.log('[NEWRELIC PROGRESS DEBUG] Attempting to send progress:', { message, userId, hasWsService: !!wsService });
        if (wsService && userId) {
            try {
                wsService.sendToUser(userId, {
                    type: 'ip_report_progress',
                    message,
                    timestamp: new Date().toISOString()
                });
                console.log('[NEWRELIC PROGRESS DEBUG] Progress message sent successfully');
            } catch (error) {
                console.error('[NEWRELIC PROGRESS DEBUG] Failed to send progress message:', error);
            }
        } else {
            console.log('[NEWRELIC PROGRESS DEBUG] Cannot send progress - missing wsService or userId:', { hasWsService: !!wsService, userId });
        }
    }

    /**
     * Execute NRQL query against New Relic
     */
    async executeNRQL(accountId, query) {
        try {
            console.log('[NEWRELIC DEBUG] Executing NRQL query via GraphQL API');
            
            // Properly escape the NRQL query for GraphQL
            const escapedQuery = query
                .replace(/\\/g, '\\\\')  // Escape backslashes first
                .replace(/"/g, '\\"')    // Escape double quotes
                .replace(/\n/g, ' ')     // Replace newlines with spaces
                .replace(/\s+/g, ' ')    // Normalize whitespace
                .trim();
            
            const graphqlQuery = `
                {
                    actor {
                        account(id: ${accountId}) {
                            nrql(query: "${escapedQuery}") {
                                results
                            }
                        }
                    }
                }
            `;
            
            const response = await axios.post(
                'https://api.newrelic.com/graphql',
                {
                    query: graphqlQuery
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'API-Key': this.apiKey
                    },
                    timeout: 30000
                }
            );
            
            if (response.data.errors) {
                console.error('[NEWRELIC ERROR] GraphQL errors:', response.data.errors);
                throw new Error(`GraphQL query failed: ${response.data.errors[0].message}`);
            }
            
            const results = response.data.data?.actor?.account?.nrql?.results;
            if (!results) {
                console.error('[NEWRELIC ERROR] No results in GraphQL response:', response.data);
                throw new Error('No results returned from GraphQL query');
            }
            
            console.log(`[NEWRELIC DEBUG] GraphQL query successful, returned ${results.length} results`);
            return results;
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] GraphQL query failed:', error);
            throw new Error(`Failed to execute GraphQL query: ${error.message}`);
        }
    }

    /**
     * Find account ID by project ID
     */
    async getAccountByProjectId(projectId) {
        try {
            console.log('[NEWRELIC DEBUG] Finding account for project:', projectId);
            
            // Get all accounts accessible with this API key
            const accountsQuery = `
                query {
                    actor {
                        accounts {
                            id
                            name
                        }
                    }
                }
            `;
            
            const response = await axios.post(this.graphqlUrl, {
                query: accountsQuery
            }, {
                headers: {
                    'Api-Key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            
            if (response.data.errors) {
                throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
            }
            
            const accounts = response.data.data.actor.accounts;
            console.log(`[NEWRELIC DEBUG] Found ${accounts.length} accessible accounts`);
            
            // First, try to find account by name containing the project ID (more efficient)
            const matchingAccount = accounts.find(account => 
                account.name.toLowerCase().includes(projectId.toLowerCase())
            );
            
            if (matchingAccount) {
                console.log(`[NEWRELIC DEBUG] Found account ${matchingAccount.id} (${matchingAccount.name}) by name matching project ID ${projectId}`);
                return matchingAccount.id;
            }
            
            // If not found by name, fall back to testing each account with NRQL queries
            console.log('[NEWRELIC DEBUG] No account found by name, testing with NRQL queries...');
            for (const account of accounts) {
                try {
                    const testQuery = `SELECT count(*) FROM Log WHERE filePath = '/var/log/platform/${projectId.replace(/'/g, "\\'")}/access.log' SINCE 1 hour ago LIMIT 1`;
                    
                    const testResponse = await axios.post(this.graphqlUrl, {
                        query: `
                            query {
                                actor {
                                    account(id: ${account.id}) {
                                        nrql(query: "${testQuery.replace(/"/g, '\\"')}") {
                                            results
                                        }
                                    }
                                }
                            }
                        `
                    }, {
                        headers: {
                            'Api-Key': this.apiKey,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    });
                    
                    if (testResponse.data.errors) {
                        console.log(`[NEWRELIC DEBUG] Account ${account.id} (${account.name}) query failed:`, testResponse.data.errors[0].message);
                        continue;
                    }
                    
                    const results = testResponse.data.data.actor.account.nrql.results;
                    if (results && results.length > 0 && results[0].count > 0) {
                        console.log(`[NEWRELIC DEBUG] Found account ${account.id} (${account.name}) with ${results[0].count} records for project ${projectId}`);
                        return account.id;
                    }
                    
                } catch (error) {
                    console.log(`[NEWRELIC DEBUG] Error testing account ${account.id}:`, error.message);
                    continue;
                }
            }
            
            throw new Error(`No account found containing data for project ID: ${projectId}`);
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to find account:', error.message);
            throw error;
        }
    }

    /**
     * Generate IP report using New Relic data
     */
    async generateIpReport(projectId, environment, options = {}, apiToken, userId, wsService = null) {
        const startTime = Date.now();
        
        try {
            console.log('[NEWRELIC IP REPORT DEBUG] Starting generateIpReport with params:', {
                projectId, environment, options, userId: userId || 'undefined'
            });
            
            const { timeframe = 60, topIps = 20, from, to } = options;
            
            console.log('[NEWRELIC IP REPORT DEBUG] Parsed options:', { timeframe, topIps, from, to });

            // Validate custom date range if provided
            if (from && to) {
                const validation = this.validateCustomDateRange(from, to);
                if (!validation.isValid) {
                    throw new Error(`Invalid custom date range: ${validation.message}`);
                }
                console.log('[NEWRELIC IP REPORT DEBUG] Custom date range validated successfully');
            }

            // Step 1: Find New Relic account ID
            this.logger.info(`[NEWRELIC IP REPORT] Finding New Relic account for ${projectId}`);
            this.sendProgress(wsService, userId, 'Finding New Relic account...');
            
            const accountId = await this.getAccountByProjectId(projectId);
            console.log('[NEWRELIC IP REPORT DEBUG] Found account ID:', accountId);
            this.sendProgress(wsService, userId, 'Found New Relic account');

            // Step 2: Calculate time range
            let startTimestamp, endTimestamp;
            if (from && to) {
                // Parse dates as UTC
                startTimestamp = Math.floor(new Date(from + 'Z').getTime() / 1000);
                endTimestamp = Math.floor(new Date(to + 'Z').getTime() / 1000);
                console.log(`[NEWRELIC IP REPORT DEBUG] Custom date range: ${startTimestamp} to ${endTimestamp}`);
            } else {
                // For "past X minutes" - use current time minus timeframe (timeframe is in minutes)
                endTimestamp = Math.floor(Date.now() / 1000);
                startTimestamp = endTimestamp - (timeframe * 60); // timeframe is in minutes, so * 60 for seconds
                console.log(`[NEWRELIC IP REPORT DEBUG] Timeframe calculation:`, {
                    timeframe,
                    timeframeMinutes: timeframe,
                    timeframeSeconds: timeframe * 60,
                    currentTime: new Date().toISOString(),
                    endTime: new Date(endTimestamp * 1000).toISOString(),
                    startTime: new Date(startTimestamp * 1000).toISOString(),
                    durationMinutes: (endTimestamp - startTimestamp) / 60,
                    durationHours: (endTimestamp - startTimestamp) / 3600
                });
            }

            // Step 3: Get IP statistics
            this.sendProgress(wsService, userId, 'Fetching IP statistics from New Relic...');
            const ipStats = await this.getIpStatistics(accountId, projectId, environment, startTimestamp, endTimestamp, topIps);
            console.log('[NEWRELIC IP REPORT DEBUG] Got IP stats:', ipStats.length);
            this.sendProgress(wsService, userId, `Found ${ipStats.length} IP addresses`);

            // Step 4: Get time series data
            this.sendProgress(wsService, userId, 'Generating time series data...');
            const timeSeriesData = await this.getTimeSeriesData(accountId, projectId, environment, startTimestamp, endTimestamp, ipStats.slice(0, 10));
            console.log('[NEWRELIC IP REPORT DEBUG] Got time series data');

            // Step 5: Prepare response
            const processingTime = Date.now() - startTime;
            this.logger.info(`[NEWRELIC IP REPORT] Report generated successfully in ${processingTime}ms`);
            this.sendProgress(wsService, userId, 'Report generation complete');

            // Calculate summary statistics
            const totalRequests = ipStats.reduce((sum, ip) => sum + ip.totalHits, 0);
            const uniqueIps = ipStats.length;

            const responseData = {
                reportId: `report-${Date.now()}`,
                summary: {
                    totalRequests,
                    uniqueIps,
                    timeRange: {
                        start: new Date(startTimestamp * 1000).toISOString(),
                        end: new Date(endTimestamp * 1000).toISOString()
                    },
                    processingTime,
                    databaseSize: 0, // Not applicable for New Relic
                    isLargeDataset: totalRequests > 100000,
                    source: 'newrelic'
                },
                ips: ipStats.map(ip => ({
                    ip: ip.ip,
                    totalHits: ip.totalHits,
                    uniqueStatusCodes: ip.uniqueStatusCodes,
                    uniqueMethods: 0, // Will be calculated from IP details if needed
                    statusCodeBreakdown: ip.statusCodeBreakdown || {},
                    firstSeen: ip.earliestTimestamp ? new Date(ip.earliestTimestamp).toISOString() : null,
                    lastSeen: ip.latestTimestamp ? new Date(ip.latestTimestamp).toISOString() : null,
                    // Ensure details field is present for summary (for frontend compatibility)
                    details: {
                        statusCodes: ip.statusCodeBreakdown || {},
                        methods: {},
                        userAgents: [],
                        topUrls: []
                    }
                })),
                timeSeriesData,
                databaseStats: {
                    totalLogs: totalRequests,
                    uniqueIps,
                    latestTimestamp: endTimestamp * 1000,
                    earliestTimestamp: startTimestamp * 1000,
                    source: 'newrelic'
                },
                rawLogs: []
            };

            const response = {
                success: true,
                data: responseData
            };

            console.log('[NEWRELIC IP REPORT DEBUG] Returning response with', ipStats.length, 'IPs and', timeSeriesData.length, 'time buckets');
            
            // Send completion message via WebSocket
            if (wsService && userId) {
                wsService.sendToUser(userId, {
                    type: 'ip_report_complete',
                    data: responseData,
                    timestamp: new Date().toISOString()
                });
            }
            
            return response;

        } catch (error) {
            console.error('[NEWRELIC IP REPORT ERROR] Failed to generate report:', error);
            throw new Error(`Failed to generate IP report: ${error.message}`);
        }
    }

    /**
     * Map environment to New Relic filePath
     */
    getFilePath(projectId, environment) {
        // Handle production environment (no suffix)
        if (environment === 'production') {
                return `/var/log/platform/${projectId}/access.log`;
        }
        
        // Handle staging environments (with _stg* suffix)
        if (environment.startsWith('staging')) {
            // Extract the staging number if it exists (staging, staging2, staging3, etc.)
            const stagingNumber = environment.replace('staging', '');
            const suffix = stagingNumber ? `_stg${stagingNumber}` : '_stg';
            return `/var/log/platform/${projectId}${suffix}/access.log`;
        }
        
        // Default to production path for unknown environments
        console.log(`[NEWRELIC DEBUG] Unknown environment '${environment}', defaulting to production path`);
        return `/var/log/platform/${projectId}/access.log`;
    }

    /**
     * Get IP statistics from New Relic
     */
    async getIpStatistics(accountId, projectId, environment, startTimestamp, endTimestamp, limit = 20) {
        try {
            console.log('[NEWRELIC DEBUG] Getting IP statistics for account:', accountId, 'project:', projectId);
            
            const filePath = this.getFilePath(projectId, environment);
            console.log('[NEWRELIC DEBUG] Using filePath:', filePath);
            
            // Get IP statistics using aparse for efficient parsing
            const query = `
                WITH aparse(message, '* - - [*] "* * *" * * "*" "*"') AS (ip, datetime, method, path, protocol, statusCode, size, referer, userAgent)
                SELECT
                    count(*) as total_requests,
                    average(timestamp) as avg_timestamp,
                    min(timestamp) as first_seen,
                    max(timestamp) as last_seen,
                    filter(count(*), WHERE statusCode >= '400') as error_count
                FROM Log
                WHERE filePath = '${filePath}'
                    AND timestamp >= ${startTimestamp * 1000} 
                    AND timestamp <= ${endTimestamp * 1000}
                FACET ip
                ORDER BY total_requests DESC
                LIMIT ${limit}
            `;
            
            console.log('[NEWRELIC DEBUG] Executing IP statistics query...');
            const results = await this.executeNRQL(accountId, query);
            console.log(`[NEWRELIC DEBUG] Retrieved ${results.length} IP statistics`);
            
            // Transform results to match expected format
            const ipStats = results.map(result => {
                const totalRequests = result.total_requests || 0;
                const errorCount = result.error_count || 0;
                
                return {
                    ip: result.facet || result.ip,
                    totalHits: totalRequests,
                    requestCount: totalRequests,
                    avgResponseTime: 0, // Not available in this query
                    maxResponseTime: 0, // Not available in this query
                    minResponseTime: 0, // Not available in this query
                    errorCount: errorCount,
                    successCount: 0, // Will be calculated dynamically from status codes
                    errorRate: totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0,
                    earliestTimestamp: result.first_seen,
                    latestTimestamp: result.last_seen,
                    uniqueStatusCodes: 0, // Will be calculated dynamically
                    uniqueMethods: 0, // Will be calculated in details if needed
                    statusCodeBreakdown: {}, // Will be populated dynamically
                    hasDetails: true
                };
            });
                
            // Fetch status codes for all IPs in a single query
            if (ipStats.length > 0) {
                console.log('[NEWRELIC DEBUG] Fetching status codes for all IPs...');
                const statusCodesData = await this.getStatusCodesForIps(accountId, filePath, startTimestamp, endTimestamp, ipStats.map(ip => ip.ip));
                
                // Update IP stats with status code information
                ipStats.forEach(ipStat => {
                    const statusData = statusCodesData[ipStat.ip];
                    if (statusData) {
                        ipStat.uniqueStatusCodes = statusData.uniqueCount;
                        ipStat.statusCodeBreakdown = statusData.breakdown;
                        
                        // Calculate success count dynamically from status codes
                let successCount = 0;
                        Object.entries(statusData.breakdown).forEach(([statusCode, count]) => {
                            // Only 200, 201, 204 are considered true success
                            if (['200', '201', '204'].includes(statusCode)) {
                                successCount += count;
                            }
                        });
                        ipStat.successCount = successCount;
                    }
                });
            }
            
            console.log(`[NEWRELIC DEBUG] Processed ${ipStats.length} IP statistics`);
            return ipStats;
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get IP statistics:', error);
            throw new Error(`Failed to get IP statistics: ${error.message}`);
        }
    }

    /**
     * Get time series data for IPs (OPTIMIZED VERSION)
     */
    async getTimeSeriesData(accountId, projectId, environment, startTimestamp, endTimestamp, ips, bucketSizeMinutes = 5) {
        try {
            const bucketSizeSeconds = bucketSizeMinutes * 60;
            const allIps = ips.map(ip => ip.ip);
            
            console.log(`[NEWRELIC DEBUG] Generating time series data for ${allIps.length} IPs with ${bucketSizeMinutes}-minute buckets (OPTIMIZED)`);
            console.log(`[NEWRELIC DEBUG] Time range: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);
            
            const filePath = this.getFilePath(projectId, environment);
            console.log('[NEWRELIC DEBUG] Using filePath for time series:', filePath);
            
            // Create IP list for the query
            const ipList = allIps.map(ip => `'${ip.replace(/'/g, "\\'")}'`).join(',');
            
            // Single optimized query using FACET and TIMESERIES
            const query = `
                WITH aparse(message, '* - - [*] "* * *" * * "*" "*"') AS (ip, datetime, method, path, protocol, statusCode, size, referer, userAgent)
                SELECT count(*) as request_count
                FROM Log
                WHERE filePath = '${filePath}'
                    AND timestamp >= ${startTimestamp * 1000} 
                    AND timestamp <= ${endTimestamp * 1000}
                    AND ip IN (${ipList})
                FACET ip
                TIMESERIES ${bucketSizeSeconds} seconds
                ORDER BY timestamp ASC
            `;
            
            console.log('[NEWRELIC DEBUG] Executing OPTIMIZED time series query (single API call)...');
            const results = await this.executeNRQL(accountId, query);
            console.log(`[NEWRELIC DEBUG] Retrieved ${results.length} time series data points`);
            
            // Process results into buckets
            const buckets = {};
            
            results.forEach(result => {
                const ip = result.facet || result.ip;
                const timestamp = result.beginTimeSeconds || Math.floor(result.timestamp / 1000);
                const requestCount = result.request_count || 0;
                
                if (!buckets[timestamp]) {
                    buckets[timestamp] = {
                        timestamp,
                        totalRequests: 0,
                        ipCounts: Object.fromEntries(allIps.map(ip => [ip, 0]))
                    };
                }
                
                buckets[timestamp].ipCounts[ip] = requestCount;
                buckets[timestamp].totalRequests += requestCount;
            });
            
            // Convert to array and fill missing buckets
            const timeSeriesData = [];
            
            // Get all unique timestamps from the results
            const allTimestamps = [...new Set(results.map(result => result.beginTimeSeconds || Math.floor(result.timestamp / 1000)))].sort((a, b) => a - b);
            
            // Create buckets for all timestamps
            allTimestamps.forEach(timestamp => {
                if (buckets[timestamp]) {
                    timeSeriesData.push(buckets[timestamp]);
                } else {
                    // Create empty bucket for missing time periods
                    timeSeriesData.push({
                        timestamp: timestamp,
                    totalRequests: 0,
                    ipCounts: Object.fromEntries(allIps.map(ip => [ip, 0]))
                });
            }
            });
            
            // Calculate total requests across all buckets
            const totalRequests = timeSeriesData.reduce((sum, bucket) => sum + bucket.totalRequests, 0);
            console.log(`[NEWRELIC DEBUG] Generated optimized time series data with ${timeSeriesData.length} buckets, total requests: ${totalRequests}`);
            
            return timeSeriesData;
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get time series data:', error);
            throw new Error(`Failed to get time series data from New Relic: ${error.message}`);
        }
    }

    /**
     * Get status codes for multiple IPs in a single query
     */
    async getStatusCodesForIps(accountId, filePath, startTimestamp, endTimestamp, ips) {
        try {
            const ipList = ips.map(ip => `'${ip.replace(/'/g, "\\'")}'`).join(',');
                
                const query = `
                    WITH aparse(message, '* - - [*] "* * *" * * "*" "*"') AS (ip, datetime, method, path, protocol, statusCode, size, referer, userAgent)
                SELECT count(*) as count
                    FROM Log
                    WHERE filePath = '${filePath}'
                        AND timestamp >= ${startTimestamp * 1000} 
                        AND timestamp <= ${endTimestamp * 1000}
                    AND ip IN (${ipList})
                FACET ip, statusCode
                    LIMIT MAX
                ORDER BY count DESC
                `;
                
            console.log('[NEWRELIC DEBUG] Executing status codes query for all IPs...');
                const results = await this.executeNRQL(accountId, query);
            console.log(`[NEWRELIC DEBUG] Retrieved ${results.length} status code entries`);
                    
            // Process results into IP-based status code breakdowns
            const statusCodesData = {};
            
            results.forEach(result => {
                // Handle both array and object facet formats
                let ip, statusCode;
                if (Array.isArray(result.facet)) {
                    ip = result.facet[0];
                    statusCode = result.facet[1];
                } else if (typeof result.facet === 'object') {
                    ip = result.facet.ip;
                    statusCode = result.facet.statusCode;
                } else {
                    // Fallback to individual fields
                    ip = result.ip;
                    statusCode = result.statusCode;
                }
                
                const count = result.count || 0;
                
                if (ip && statusCode && count > 0) {
                    if (!statusCodesData[ip]) {
                        statusCodesData[ip] = {
                            uniqueCount: 0,
                            breakdown: {}
                        };
                    }
                    
                    statusCodesData[ip].breakdown[statusCode] = count;
                    statusCodesData[ip].uniqueCount = Object.keys(statusCodesData[ip].breakdown).length;
                }
            });
            
            console.log(`[NEWRELIC DEBUG] Processed status codes for ${Object.keys(statusCodesData).length} IPs`);
            return statusCodesData;
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get status codes for IPs:', error);
            return {};
        }
    }

    /**
     * Create empty time buckets for visualization when no data is available
     */
    createEmptyTimeBuckets(startTimestamp, endTimestamp, bucketSizeSeconds, ips) {
        const buckets = [];
        const allIps = ips.map(ip => ip.ip);
        
        for (let time = startTimestamp; time <= endTimestamp; time += bucketSizeSeconds) {
            const bucket = {
                timestamp: time,
                totalRequests: 0,
                ipCounts: {}
            };
            
            allIps.forEach(ip => {
                bucket.ipCounts[ip] = 0;
            });
            
            buckets.push(bucket);
        }
        
        return buckets;
    }

    /**
     * Get detailed information for a specific IP (OPTIMIZED - Single Query)
     */
    async getIpDetails(accountId, projectId, ip, startTimestamp, endTimestamp) {
        try {
            const filePath = this.getFilePath(projectId, 'production'); // Use the file path helper
            const timeFilter = startTimestamp && endTimestamp 
                ? `AND timestamp >= ${startTimestamp * 1000} AND timestamp <= ${endTimestamp * 1000}`
                : 'SINCE 24 hours ago';

            // Single optimized query to get all details at once
            const query = `
                WITH aparse(message, '* - - [*] "* * *" * * "*" "*"') AS (ip, datetime, method, path, protocol, statusCode, size, referer, userAgent)
                SELECT count(*) as count
                FROM Log 
                WHERE filePath = '${filePath}'
                    AND ip = '${ip.replace(/'/g, "\\'")}'
                    ${timeFilter}
                FACET path, method, statusCode, userAgent
                LIMIT MAX
            `.trim();

            console.log('[NEWRELIC DEBUG] Executing optimized IP details query for:', ip);
            const results = await this.executeNRQL(accountId, query);
            
            if (!results || results.length === 0) {
                throw new Error(`No data found for IP ${ip}`);
            }
            
            console.log(`[NEWRELIC DEBUG] IP details query successful for: ${ip}, returned ${results.length} results`);
            
            // Process results to extract different facets
            const urls = {};
            const methods = {};
            const statusCodes = {};
            const userAgents = {};
            // New: Per-URL status code and method aggregation
            const urlStatusCodes = {};
            const urlMethods = {};
            // New: Per-URL user agent aggregation
            const urlUserAgents = {};
            
            results.forEach(result => {
                const facets = result.facet || [];
                const count = result.count || 0;
                
                if (facets.length >= 4) {
                    const path = facets[0];
                    const method = facets[1];
                    const statusCode = facets[2];
                    const userAgent = facets[3];
            
                    // Aggregate URLs
                    if (path) {
                        urls[path] = (urls[path] || 0) + count;
                        // Per-URL status codes
                        if (statusCode) {
                            if (!urlStatusCodes[path]) urlStatusCodes[path] = {};
                            urlStatusCodes[path][statusCode] = (urlStatusCodes[path][statusCode] || 0) + count;
                        }
                        // Per-URL methods
                        if (method) {
                            if (!urlMethods[path]) urlMethods[path] = {};
                            urlMethods[path][method] = (urlMethods[path][method] || 0) + count;
                        }
                        // Per-URL user agents
                        if (userAgent) {
                            if (!urlUserAgents[path]) urlUserAgents[path] = new Set();
                            urlUserAgents[path].add(userAgent);
                        }
                    }
                    
                    // Aggregate methods (global)
                    if (method) {
                        methods[method] = (methods[method] || 0) + count;
                    }
                    
                    // Aggregate status codes (global)
                    if (statusCode) {
                        statusCodes[statusCode] = (statusCodes[statusCode] || 0) + count;
                    }
                    
                    // Aggregate user agents (global)
                    if (userAgent) {
                        userAgents[userAgent] = (userAgents[userAgent] || 0) + count;
                    }
                }
            });
            
            // Convert to arrays and sort by count
            const topUrls = Object.entries(urls)
                .map(([url, count]) => ({
                    url: url || '/unknown',
                    count: count,
                    statusCodes: urlStatusCodes[url] ? Object.keys(urlStatusCodes[url]) : [],
                    methods: urlMethods[url] ? Object.keys(urlMethods[url]) : [],
                    userAgents: urlUserAgents[url] ? Array.from(urlUserAgents[url]) : [],
                    latestTimestamp: Date.now(),
                    firstTimestamp: Date.now() - 3600000
                }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
            
            const userAgentsList = Object.entries(userAgents)
                .map(([userAgent, count]) => ({
                    userAgent: userAgent || 'Unknown',
                    count: count
                }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
            
            console.log(`[NEWRELIC DEBUG] Processed details for IP ${ip}: ${topUrls.length} URLs, ${Object.keys(userAgents).length} user agents, ${Object.keys(statusCodes).length} status codes, ${Object.keys(methods).length} methods`);
            
            return {
                topUrls,
                userAgents: userAgentsList,
                statusCodes,
                methods
            };
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get IP details:', error);
            throw new Error(`Failed to get IP details from New Relic: ${error.message}`);
        }
    }

    /**
     * Get paginated IP details with optional filters
     * This method fetches 10 results per page using timestamp-based pagination
     */
    async getIpDetails(accountId, projectId, ip, startTimestamp, endTimestamp, filters = {}, lastTimestamp = null) {
        try {
            const filePath = this.getFilePath(projectId, 'production');
            const timeFilter = startTimestamp && endTimestamp 
                ? `AND timestamp >= ${startTimestamp * 1000} AND timestamp <= ${endTimestamp * 1000}`
                : 'SINCE 24 hours ago';

            // Build filter conditions
            let filterConditions = [];
            
            if (filters.statusCode) {
                filterConditions.push(`AND statusCode = '${filters.statusCode.replace(/'/g, "\\'")}'`);
            }
            
            if (filters.method) {
                filterConditions.push(`AND method = '${filters.method.replace(/'/g, "\\'")}'`);
            }
            
            if (filters.url) {
                filterConditions.push(`AND path LIKE '%${filters.url.replace(/'/g, "\\'")}%'`);
            }
            
            if (filters.userAgent) {
                filterConditions.push(`AND userAgent LIKE '%${filters.userAgent.replace(/'/g, "\\'")}%'`);
            }

            // Add timestamp-based pagination
            if (lastTimestamp) {
                filterConditions.push(`AND timestamp < ${lastTimestamp}`);
            }

            const filterClause = filterConditions.join(' ');

            // Query to get paginated results (10 per page)
            const query = `
                WITH aparse(message, '* - - [*] "* * *" * * "*" "*"') AS (ip, datetime, method, path, protocol, statusCode, size, referer, userAgent)
                SELECT
                    timestamp,  
                    ip,
                    method,
                    statusCode,
                    path AS url,
                    userAgent
                FROM Log
                WHERE filePath = '${filePath}'
                    AND ip = '${ip.replace(/'/g, "\\'")}'
                    ${timeFilter}
                    ${filterClause}
                ORDER BY timestamp DESC
                LIMIT 10
            `.trim();

            console.log('[NEWRELIC DEBUG] Executing paginated IP details query for:', ip, 'with filters:', filters, 'lastTimestamp:', lastTimestamp);
            const results = await this.executeNRQL(accountId, query);
            
            if (!results || results.length === 0) {
            return {
                    requests: [],
                    totalCount: 0,
                    hasMore: false,
                    lastTimestamp: null
                };
            }
            
            console.log(`[NEWRELIC DEBUG] Paginated query successful for: ${ip}, returned ${results.length} results`);
            
            // Process results
            const requests = results.map(result => ({
                timestamp: result.timestamp,
                ip: result.ip,
                method: result.method || 'Unknown',
                statusCode: result.statusCode || 'Unknown',
                url: result.url || '/unknown',
                userAgent: result.userAgent || 'Unknown'
            }));

            // Check if there are more results by getting the last timestamp
            const lastResultTimestamp = results[results.length - 1].timestamp;
            const hasMore = results.length === 10; // If we got exactly 10 results, there might be more

            return {
                requests,
                totalCount: results.length,
                hasMore,
                lastTimestamp: lastResultTimestamp
            };
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get IP details:', error);
            throw new Error(`Failed to get IP details from New Relic: ${error.message}`);
        }
    }

    /**
     * Get paginated URLs for a specific IP
     */
    async getIpUrls(accountId, projectId, ip, startTimestamp, endTimestamp, limit = 10, offset = 0) {
        try {
            const filePath = this.getFilePath(projectId, 'production'); // Use the file path helper
            const timeFilter = startTimestamp && endTimestamp 
                ? `AND timestamp >= ${startTimestamp * 1000} AND timestamp <= ${endTimestamp * 1000}`
                : 'SINCE 24 hours ago';

            const query = `
                WITH aparse(message, '* - - [*] "* * *" * * "*" "*"') AS (ip, datetime, method, path, protocol, statusCode, size, referer, userAgent)
                SELECT 
                    path as url,
                    timestamp,
                    statusCode as status,
                    method,
                    0 as responseTime
                FROM Log 
                WHERE filePath = '${filePath}'
                    AND ip = '${ip.replace(/'/g, "\\'")}'
                    ${timeFilter}
                ORDER BY timestamp DESC
                LIMIT ${limit}
                OFFSET ${offset}
            `.trim();

            console.log('[NEWRELIC DEBUG] Executing IP URLs query for:', ip);
            const results = await this.executeNRQL(accountId, query);
            
            if (!results || results.length === 0) {
                return [];
            }
            
            console.log('[NEWRELIC DEBUG] IP URLs query successful for:', ip);
            
            return results.map(result => ({
                url: result.url || '/unknown',
                timestamp: Math.floor(result.timestamp / 1000),
                status: result.status || 'unknown',
                method: result.method || 'UNKNOWN',
                responseTime: result.responseTime || 0
            }));
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get IP URLs:', error);
            throw new Error(`Failed to get IP URLs from New Relic: ${error.message}`);
        }
    }

    /**
     * Get UserAgent data for a specific IP
     */
    async getIpUserAgents(accountId, projectId, ip, startTimestamp, endTimestamp) {
        try {
            const timeFilter = startTimestamp && endTimestamp 
                ? `AND timestamp >= ${startTimestamp * 1000} AND timestamp <= ${endTimestamp * 1000}`
                : 'SINCE 24 hours ago';

            const query = `
                SELECT 
                    count(*) as count,
                    latest(timestamp) as latest_timestamp,
                    earliest(timestamp) as earliest_timestamp
                FROM Log 
                WHERE filePath = '/var/log/platform/${projectId.replace(/'/g, "\\'")}/access.log'
                    AND client_ip = '${ip.replace(/'/g, "\\'")}'
                    ${timeFilter}
                FACET user_agent
                ORDER BY count DESC
                LIMIT 10
            `.trim();

            console.log('[NEWRELIC DEBUG] Executing IP user agents query for:', ip);
            const results = await this.executeNRQL(accountId, query);
            
            if (!results || results.length === 0) {
                return [];
            }
            
            console.log('[NEWRELIC DEBUG] IP user agents query successful for:', ip);
            
            return results.map(result => ({
                userAgent: result.user_agent || 'Unknown',
                count: result.count || 0,
                latestTimestamp: Math.floor((result.latest_timestamp || Date.now()) / 1000),
                firstTimestamp: Math.floor((result.earliest_timestamp || Date.now() - 3600000) / 1000)
            }));
            
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get IP user agents:', error);
            throw new Error(`Failed to get IP user agents from New Relic: ${error.message}`);
        }
    }

    /**
     * Get chart data for specific IPs and time range
     */
    async getChartData(accountId, projectId, ips, startTimestamp, endTimestamp, bucketSizeMinutes = 5) {
        const bucketSizeSeconds = bucketSizeMinutes * 60;
        const ipList = ips.map(ip => `'${ip.replace(/'/g, "\\'")}'`).join(',');
        
        const query = `
            SELECT 
                count(*) as request_count,
                average(time_elapsed) as avg_response_time
            FROM Log 
            WHERE filePath = '/var/log/platform/${projectId.replace(/'/g, "\\'")}/access.log'
                AND timestamp >= ${startTimestamp * 1000} 
                AND timestamp <= ${endTimestamp * 1000}
                AND client_ip IN (${ipList})
            FACET client_ip
            TIMESERIES ${bucketSizeSeconds} seconds
            ORDER BY timestamp ASC
        `;

        try {
            const results = await this.executeNRQL(accountId, query);
            
            // Group by time bucket and IP
            const timeBuckets = {};
            
            results.forEach(result => {
                const ip = result.client_ip;
                const timestamp = Math.floor(result.timestamp / 1000);
                
                if (!timeBuckets[timestamp]) {
                    timeBuckets[timestamp] = {
                        timestamp,
                        totalRequests: 0,
                        ipCounts: {}
                    };
                }
                
                timeBuckets[timestamp].totalRequests += result.request_count;
                timeBuckets[timestamp].ipCounts[ip] = result.request_count;
            });
            
            // Convert to array and sort by timestamp
            const timeSeriesData = Object.values(timeBuckets).sort((a, b) => a.timestamp - b.timestamp);
            
            return timeSeriesData;
        } catch (error) {
            console.error('[NEWRELIC ERROR] Failed to get chart data:', error);
            throw error;
        }
    }

    /**
     * Validate custom date range
     */
    validateCustomDateRange(from, to) {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return { isValid: false, message: 'Invalid date format' };
        }
        
        if (fromDate >= toDate) {
            return { isValid: false, message: 'Start date must be before end date' };
        }
        
        const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        if (toDate.getTime() - fromDate.getTime() > maxDuration) {
            return { isValid: false, message: 'Date range cannot exceed 7 days' };
        }
        
        return { isValid: true };
    }
}

// Export singleton instance
export const newRelicIpReportService = new NewRelicIpReportService(); 