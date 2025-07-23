import { sqliteService } from './sqliteService.js';
import { logger } from './logger.js';
import MagentoCloudAdapter from '../adapters/magentoCloud.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { gunzipSync } from 'zlib';

const execAsync = promisify(exec);

export class IpReportService {
    constructor() {
        this.logger = logger;
        
        // Enable garbage collection if available
        if (global.gc) {
            console.log('[IP REPORT] Garbage collection enabled');
        } else {
            console.log('[IP REPORT] Garbage collection not available. Start with --expose-gc for better memory management');
        }
    }

    /**
     * Send progress updates via WebSocket
     */
    sendProgress(wsService, userId, message) {
        console.log('[PROGRESS DEBUG] Attempting to send progress:', { message, userId, hasWsService: !!wsService });
        if (wsService && userId) {
            try {
                wsService.sendToUser(userId, {
                    type: 'ip_report_progress',
                    message,
                    timestamp: new Date().toISOString()
                });
                console.log('[PROGRESS DEBUG] Progress message sent successfully');
            } catch (error) {
                console.error('[PROGRESS DEBUG] Failed to send progress message:', error);
            }
        } else {
            console.log('[PROGRESS DEBUG] Cannot send progress - missing wsService or userId:', { hasWsService: !!wsService, userId });
        }
    }

    /**
     * Generate IP report using SQLite database
     */
    async generateIpReport(projectId, environment, options = {}, apiToken, userId, wsService = null) {
        const startTime = Date.now();
        
        try {
            console.log('[IP REPORT DEBUG] Starting generateIpReport with params:', {
                projectId, environment, options, userId: userId || 'undefined'
            });
            
            const { timeframe = 60, topIps = 20, from, to } = options;
            
            console.log('[IP REPORT DEBUG] Parsed options:', { timeframe, topIps, from, to });

            // Validate custom date range if provided
            if (from && to) {
                const validation = this.validateCustomDateRange(from, to);
                if (!validation.isValid) {
                    throw new Error(`Invalid custom date range: ${validation.message}`);
                }
                console.log('[IP REPORT DEBUG] Custom date range validated successfully');
            }

            // Step 1: Get all nodes for the environment
            this.logger.info(`[IP REPORT] Getting nodes for ${projectId}/${environment}`);
            console.log('[IP REPORT DEBUG] About to get nodes...');
            this.sendProgress(wsService, userId, 'Getting available nodes...');
            
            let nodes;
            try {
                console.log('[IP REPORT DEBUG] About to call getEnvironmentNodes with:', { projectId, environment, hasApiToken: !!apiToken, userId });
                nodes = await this.getEnvironmentNodes(projectId, environment, apiToken, userId);
                console.log('[IP REPORT DEBUG] Successfully got nodes:', nodes);
            } catch (nodeError) {
                console.error('[IP REPORT ERROR] Failed to get nodes:', nodeError);
                console.error('[IP REPORT ERROR] Stack trace:', nodeError.stack);
                throw new Error(`Failed to get environment nodes: ${nodeError.message}`);
            }
            console.log('[IP REPORT DEBUG] Got nodes:', nodes);
            this.logger.info(`[IP REPORT] Found ${nodes.length} nodes: ${nodes.join(', ')}`);
            this.sendProgress(wsService, userId, `Found ${nodes.length} nodes`);

            // Step 2: Calculate time range
            let startTime, endTime;
            if (from && to) {
                // Parse dates as UTC to avoid timezone conversion issues
                // The frontend sends dates in format "2025-07-16T00:00"
                startTime = Math.floor(new Date(from + 'Z').getTime() / 1000);
                endTime = Math.floor(new Date(to + 'Z').getTime() / 1000);
                console.log(`[IP REPORT DEBUG] Parsed dates as UTC: from=${from}Z -> ${new Date(startTime * 1000).toISOString()}, to=${to}Z -> ${new Date(endTime * 1000).toISOString()}`);
            } else {
                // For "past X hours" - calculate from most recent log, not current time
                const dbStats = await sqliteService.getDatabaseStats(projectId, environment);
                if (dbStats && dbStats.latest_timestamp) {
                    endTime = dbStats.latest_timestamp;
                    startTime = endTime - (timeframe * 60);
                    console.log(`[IP REPORT DEBUG] Using latest log time as reference: ${new Date(endTime * 1000).toISOString()}`);
                } else {
                    // Fallback to current time if no data exists
                    endTime = Math.floor(Date.now() / 1000);
                    startTime = endTime - (timeframe * 60);
                    console.log(`[IP REPORT DEBUG] Using current time as reference (no existing data)`);
                }
            }

            console.log(`[IP REPORT DEBUG] Time range: ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);

            // Step 3: Check if we have data in SQLite for this time range
            const dbStats = await sqliteService.getDatabaseStats(projectId, environment);
            console.log('[IP REPORT DEBUG] Database stats:', dbStats);

            let needsDataCollection = true;
            if (dbStats.total_logs > 0 && dbStats.earliest_timestamp && dbStats.latest_timestamp) {
                const dbStartTime = dbStats.earliest_timestamp;
                const dbEndTime = dbStats.latest_timestamp;
                
                // Check if our requested time range is covered by existing data
                if (startTime >= dbStartTime && endTime <= dbEndTime) {
                    console.log('[IP REPORT DEBUG] Time range covered by existing database data');
                    needsDataCollection = false;
                } else {
                    console.log('[IP REPORT DEBUG] Time range not fully covered, need to collect more data');
                }
            }

            // Step 4: Collect and store data if needed
            if (needsDataCollection) {
                this.sendProgress(wsService, userId, 'Collecting access logs from servers...');
                const isCustomTimeRange = !!(from && to);
                await this.collectAndStoreLogs(projectId, environment, nodes, apiToken, userId, wsService, { startTime, endTime, isCustomTimeRange });
            }

            // Step 5: Get top IPs from SQLite
            this.sendProgress(wsService, userId, 'Analyzing IP data...');
            console.log('[IP REPORT DEBUG] Getting top IPs from database...');
            
            const topIpsData = await sqliteService.getTopIps(projectId, environment, topIps, startTime, endTime);
            console.log('[IP REPORT DEBUG] Top IPs retrieved:', topIpsData.length);

            // Step 6: Get time series data for charting
            console.log('[IP REPORT DEBUG] Getting time series data...');
            const topIpAddresses = topIpsData.map(ip => ip.ip);
            const bucketSizeMinutes = this.calculateOptimalBucketSize(endTime - startTime);
            const timeSeriesData = await sqliteService.getTimeSeriesData(
                projectId, environment, topIpAddresses, startTime, endTime, bucketSizeMinutes
            );

            // Step 7: Format response
            const processingTime = Date.now() - startTime;
            this.logger.info(`[IP REPORT] Report generated successfully in ${processingTime}ms`);

            const responseData = {
                reportId: `report-${Date.now()}`,
                    summary: {
                    totalRequests: dbStats.total_logs,
                    uniqueIps: dbStats.unique_ips,
                    timeRange: {
                        start: new Date(startTime * 1000).toISOString(),
                        end: new Date(endTime * 1000).toISOString()
                    },
                    processingTime,
                    databaseSize: dbStats.database_size_mb,
                    isLargeDataset: dbStats.total_logs > 100000
                },
                ips: topIpsData.map(ip => ({
                    ip: ip.ip,
                    totalHits: ip.total_hits,
                    uniqueStatusCodes: ip.unique_status_codes,
                    uniqueMethods: ip.unique_methods,
                    statusCodeBreakdown: ip.statusCodeBreakdown || {},
                    firstSeen: ip.first_seen ? new Date(ip.first_seen * 1000).toISOString() : null,
                    lastSeen: ip.last_seen ? new Date(ip.last_seen * 1000).toISOString() : null
                })),
                timeSeriesData,
                databaseStats: dbStats,
                rawLogs: [] // Add empty rawLogs array for frontend compatibility
            };

            const response = {
                success: true,
                data: responseData
            };

            console.log('[IP REPORT DEBUG] Returning response with', topIpsData.length, 'IPs and', timeSeriesData.length, 'time buckets');
            
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
            console.error('[IP REPORT ERROR] Error generating report:', error);
            this.logger.error(`[IP REPORT] Error generating report:`, error);
            
            // Send error message via WebSocket
            if (wsService && userId) {
                wsService.sendToUser(userId, {
                    type: 'ip_report_error',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
            
            throw error;
        }
    }

    /**
     * Get all nodes for a specific environment
     */
    async getEnvironmentNodes(projectId, environment, apiToken, userId) {
        try {
            console.log('[IP REPORT DEBUG] Creating MagentoCloudAdapter...');
            const magentoCloud = new MagentoCloudAdapter();
            
            console.log('[IP REPORT DEBUG] Validating executable...');
            await magentoCloud.validateExecutable();

            // Use magento-cloud ssh command to get all nodes
            const command = `ssh -p ${projectId} -e ${environment} --all`;
            console.log('[IP REPORT DEBUG] Executing command:', command);
            console.log('[IP REPORT DEBUG] executeCommand params:', { command, hasApiToken: !!apiToken, userId });
            
            const { stdout, stderr } = await magentoCloud.executeCommand(command, apiToken, userId);
            
            console.log('[IP REPORT DEBUG] Command stdout:', stdout);
            console.log('[IP REPORT DEBUG] Command stderr:', stderr);
            
            if (stderr) {
                throw new Error(`Failed to get nodes: ${stderr}`);
            }

            // Parse the output to extract SSH connection strings
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
     * Collect and store logs from all nodes
     */
    async collectAndStoreLogs(projectId, environment, nodes, apiToken, userId, wsService = null, options = {}) {
        try {
            const { startTime, endTime, isCustomTimeRange = false } = options;
            
            console.log('[IP REPORT DEBUG] Starting log collection from', nodes.length, 'nodes');
            console.log('[IP REPORT DEBUG] Time range:', { startTime, endTime, isCustomTimeRange });
            
            // Step 1: Determine which files to download based on time range
            const filesToDownload = await this.getRelevantFiles(nodes, startTime, endTime, isCustomTimeRange);
            console.log('[IP REPORT DEBUG] Files to download:', filesToDownload.length);

            // Step 2: Process files sequentially to avoid database locking issues
            console.log(`[IP REPORT DEBUG] Processing ${filesToDownload.length} files sequentially to avoid database conflicts`);
            
            let totalLogsInserted = 0;
            let successfulNodes = 0;

            // Process files sequentially but with optimized database operations
            for (let i = 0; i < filesToDownload.length; i++) {
                const fileInfo = filesToDownload[i];
                console.log(`[IP REPORT DEBUG] Processing file ${i + 1}/${filesToDownload.length}: ${fileInfo.filePath} from ${fileInfo.nodeNumber}`);

                this.sendProgress(wsService, userId, `Processing ${fileInfo.fileName} from node ${fileInfo.nodeNumber}... (${i + 1}/${filesToDownload.length})`);

                try {
                    // Download file
                    const localPath = await this.downloadFile(fileInfo.sshConnection, fileInfo.filePath, projectId, environment);
                    
                    // Process and store logs
                    const logsInserted = await this.processAndStoreFile(localPath, projectId, environment, fileInfo.fileName, fileInfo.nodeNumber);
                    totalLogsInserted += logsInserted;
                    
                    console.log(`[IP REPORT DEBUG] Inserted ${logsInserted} logs from ${fileInfo.fileName}`);
                    successfulNodes++;
                    
                    // Update progress
                    const progress = Math.round(((i + 1) / filesToDownload.length) * 100);
                    this.sendProgress(wsService, userId, `Processed ${i + 1}/${filesToDownload.length} files (${totalLogsInserted.toLocaleString()} logs)`);
                    
                } catch (fileError) {
                    console.error(`[IP REPORT DEBUG] Error processing file ${fileInfo.filePath}:`, fileError.message);
                    // Continue with other files
                }
            }

            console.log(`[IP REPORT DEBUG] Collection completed: ${totalLogsInserted} logs inserted from ${successfulNodes} successful files`);
            this.sendProgress(wsService, userId, `Collection completed: ${totalLogsInserted.toLocaleString()} logs stored`);

            return totalLogsInserted;

        } catch (error) {
            console.error('[IP REPORT ERROR] Error collecting logs:', error);
            throw error;
        }
    }

    /**
     * Get relevant files based on time range
     */
    async getRelevantFiles(nodes, startTime, endTime, isCustomTimeRange = false) {
        const filesToDownload = [];
        
        for (const sshConnection of nodes) {
            const nodeNumber = sshConnection.split('.')[0];
            console.log(`[IP REPORT DEBUG] Getting file list from node ${nodeNumber}`);

            try {
                // Get list of all log files with dates
                const fileListCommand = `ssh -o ConnectTimeout=10 -o ServerAliveInterval=5 -T ${sshConnection} "ls -lah /var/log/platform/*/access.log*"`;
                const { stdout } = await execAsync(fileListCommand, { timeout: 30000 });
                
                // Parse file list and filter by relevance
                const relevantFiles = this.parseFileList(stdout, startTime, endTime, isCustomTimeRange);
                
                for (const fileInfo of relevantFiles) {
                    filesToDownload.push({
                        sshConnection,
                        nodeNumber,
                        filePath: fileInfo.path,
                        fileName: fileInfo.name,
                        fileSize: fileInfo.size,
                        fileDate: fileInfo.date
                    });
                }
            
        } catch (error) {
                console.error(`[IP REPORT DEBUG] Error getting file list from node ${nodeNumber}:`, error.message);
                // Continue with other nodes
            }
        }

        console.log(`[IP REPORT DEBUG] Found ${filesToDownload.length} relevant files to download`);
        
        // Debug: Show which files are being downloaded from which nodes
        const filesByNode = {};
        for (const file of filesToDownload) {
            if (!filesByNode[file.nodeNumber]) {
                filesByNode[file.nodeNumber] = [];
            }
            filesByNode[file.nodeNumber].push(file.fileName);
        }
        
        for (const [nodeNumber, files] of Object.entries(filesByNode)) {
            console.log(`[IP REPORT DEBUG] Node ${nodeNumber} files: ${files.join(', ')}`);
        }
        
        return filesToDownload;
    }

    /**
     * Parse file list and filter by time relevance
     */
    parseFileList(fileListOutput, startTime, endTime, isCustomTimeRange = false) {
        const lines = fileListOutput.split('\n').filter(line => line.trim());
        const relevantFiles = [];
        
        const startDate = new Date(startTime * 1000);
        const endDate = new Date(endTime * 1000);
        
        console.log(`[IP REPORT DEBUG] Looking for files between ${startDate.toISOString()} and ${endDate.toISOString()}`);
        
        for (const line of lines) {
            // Parse ls -lah output: permissions, links, user, group, size, month, day, time/year, path
            const match = line.match(/.*\s+([A-Za-z]{3})\s+(\d{1,2})\s+([\d:]+)\s+(\S+\/access\.log.*?)$/);
            if (match) {
                const [, monthStr, dayStr, timeStr, filePath] = match;
                
                const monthMap = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                
                const currentYear = new Date().getFullYear();
                const month = monthMap[monthStr];
                const day = parseInt(dayStr);
                
                if (month !== undefined) {
                    // Parse time (could be time or year)
                    let year = currentYear;
                    let hour = 0, minute = 0;
                    
                    if (timeStr.includes(':')) {
                        // It's a time
                        const [hourStr, minuteStr] = timeStr.split(':');
                        hour = parseInt(hourStr);
                        minute = parseInt(minuteStr);
                    } else {
                        // It's a year
                        year = parseInt(timeStr);
                    }
                    
                    const fileDate = new Date(year, month, day, hour, minute);
                    
                    // Check if file is relevant to our time range
                    const isRelevant = this.isFileRelevant(fileDate, startDate, endDate, filePath, isCustomTimeRange);
                    
                    if (isRelevant) {
                        relevantFiles.push({
                            path: filePath,
                            name: path.basename(filePath),
                            size: 'unknown', // Could parse from ls output
                            date: fileDate
                        });
                    }
                }
            }
        }
        
        return relevantFiles;
    }

    /**
     * Check if a file is relevant to the time range
     */
    isFileRelevant(fileDate, startDate, endDate, filePath, isCustomTimeRange = false) {
        // Calculate the time range duration
        const timeRangeDuration = endDate.getTime() - startDate.getTime();
        const timeRangeHours = timeRangeDuration / (1000 * 60 * 60);
        
                    console.log(`[IP REPORT DEBUG] Checking file relevance for ${filePath}, timeRange: ${timeRangeHours} hours, isCustomTimeRange: ${isCustomTimeRange}`);
            console.log(`[IP REPORT DEBUG] Requested time range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        
        // Check if it's an access log file first
        const isAccessLog = filePath.includes('access.log');
        if (!isAccessLog) {
            console.log(`[IP REPORT DEBUG] Not an access log file: ${filePath}`);
            return false;
        }
        
        // For custom time ranges: use date-based logic regardless of duration
        if (isCustomTimeRange) {
            // For custom time ranges, only include current access.log if the range extends to recent time
            // (within the last hour from current time)
            if (filePath.endsWith('access.log')) {
                const currentTime = Date.now();
                const endTimeMs = endDate.getTime();
                const oneHourMs = 60 * 60 * 1000;
                const isRecentRange = (currentTime - endTimeMs) <= oneHourMs;
                
                if (isRecentRange) {
                    console.log(`[IP REPORT DEBUG] Custom time range: ${filePath} relevant: true (current log, recent range)`);
                    return true;
                } else {
                    console.log(`[IP REPORT DEBUG] Custom time range: ${filePath} relevant: false (current log, not recent range)`);
                    return false;
                }
            }
            
            // For .gz files, check if the file creation date is relevant to the requested time range
            const fileDateMs = fileDate.getTime();
            const startDateMs = startDate.getTime();
            const endDateMs = endDate.getTime();
            
            // Convert to UTC dates for day comparison (avoid timezone issues)
            const fileDay = new Date(fileDateMs).toISOString().split('T')[0];
            const startDay = new Date(startDateMs).toISOString().split('T')[0];
            const endDay = new Date(endDateMs).toISOString().split('T')[0];
            
            console.log(`[IP REPORT DEBUG] Date comparison details: fileDateMs=${fileDateMs}, startDateMs=${startDateMs}, endDateMs=${endDateMs}`);
            
            // For very short ranges (2 hours or less), only include files from the start day
            // For longer ranges, include all days within the range
            let isWithinRange = false;
            if (timeRangeHours <= 2) {
                // For 2-hour ranges, only include files from the start day
                isWithinRange = fileDay === startDay;
                console.log(`[IP REPORT DEBUG] 2-hour range: fileDay=${fileDay}, startDay=${startDay}, endDay=${endDay}, isWithinRange=${isWithinRange}`);
            } else {
                // For longer ranges, include files from all days within the range
                isWithinRange = fileDay >= startDay && fileDay <= endDay;
            }
            
            // Only include day before for ranges longer than 6 hours
            let isDayBefore = false;
            if (timeRangeHours > 6) {
                isDayBefore = fileDay === new Date(startDateMs - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            }
            
            const relevant = isWithinRange || isDayBefore;
            const dayBefore = new Date(startDateMs - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            console.log(`[IP REPORT DEBUG] Custom time range: ${filePath} fileDate: ${fileDate.toISOString()}, fileDay: ${fileDay}, startDay: ${startDay}, endDay: ${endDay}, dayBefore: ${dayBefore}, isWithinRange: ${isWithinRange}, isDayBefore: ${isDayBefore}, relevant: ${relevant}`);
            return relevant;
        }
        
        // For "past X hours" timeframes: apply the 12-hour rule
        // For past 5, 10, 15, 30, 45, 60 minutes and past 1, 3, 6, 12 hours: 
        // Include access.log and any .gz files that might contain data for the requested time range
        if (timeRangeHours <= 12) {
            // Always include current access.log
            if (filePath.endsWith('access.log')) {
                console.log(`[IP REPORT DEBUG] <= 12 hours: ${filePath} relevant: true (current log)`);
                return true;
            }
            
            // For .gz files, check if the file creation date is relevant to the requested time range
            const fileDateMs = fileDate.getTime();
            const startDateMs = startDate.getTime();
            const endDateMs = endDate.getTime();
            
            // Convert to UTC dates for day comparison (avoid timezone issues)
            const fileDay = new Date(fileDateMs).toISOString().split('T')[0];
            const startDay = new Date(startDateMs).toISOString().split('T')[0];
            const endDay = new Date(endDateMs).toISOString().split('T')[0];
            
            // Check if file was created on the same day as the range or adjacent days
            // For short timeframes, include files from adjacent days to ensure we don't miss data
            const isSameDay = fileDay === startDay || fileDay === endDay;
            const isAdjacentDay = fileDay === new Date(startDateMs - 24 * 60 * 60 * 1000).toISOString().split('T')[0] ||
                                 fileDay === new Date(endDateMs + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const relevant = isSameDay || isAdjacentDay;
            console.log(`[IP REPORT DEBUG] <= 12 hours: ${filePath} fileDate: ${fileDate.toISOString()}, fileDay: ${fileDay}, startDay: ${startDay}, endDay: ${endDay}, relevant: ${relevant}`);
            return relevant;
        }
        
        // For past 24 hours: access.log, access.log.1.gz, and any .gz files that might contain data
        if (timeRangeHours <= 24) {
            
            // Always include access.log and access.log.1.gz
            if (filePath.endsWith('access.log') || filePath.endsWith('access.log.1.gz')) {
                console.log(`[IP REPORT DEBUG] <= 24 hours: ${filePath} relevant: true (current/previous day)`);
                return true;
            }
            
            // For .gz files, be more inclusive to ensure we don't miss data
            // Include files from 1 day before start to 1 day after end
            const fileDateMs = fileDate.getTime();
            const startDateMs = startDate.getTime();
            const endDateMs = endDate.getTime();
            
            // Convert to UTC dates for day comparison (avoid timezone issues)
            const fileDay = new Date(fileDateMs).toISOString().split('T')[0];
            const startDay = new Date(startDateMs).toISOString().split('T')[0];
            const endDay = new Date(endDateMs).toISOString().split('T')[0];
            
            // Check if file was created on the same day as the range or adjacent days
            const isSameDay = fileDay === startDay || fileDay === endDay;
            const isAdjacentDay = fileDay === new Date(startDateMs - 24 * 60 * 60 * 1000).toISOString().split('T')[0] ||
                                 fileDay === new Date(endDateMs + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const relevant = isSameDay || isAdjacentDay;
            
            console.log(`[IP REPORT DEBUG] <= 24 hours: ${filePath} fileDate: ${fileDate.toISOString()}, fileDay: ${fileDay}, startDay: ${startDay}, endDay: ${endDay}, relevant: ${relevant}`);
            return relevant;
        }
        
        // For longer ranges: include all files that could contain data for the requested range
        const fileDateMs = fileDate.getTime();
        const startDateMs = startDate.getTime();
        const endDateMs = endDate.getTime();
        
        // For multi-day ranges, be more inclusive to ensure we don't miss data
        // Include files from 2 days before start to 1 day after end
        // This accounts for:
        // 1. Files created on different days but containing relevant data
        // 2. Timezone differences in file creation
        // 3. Log rotation timing variations
        const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
        const oneDayMs = 24 * 60 * 60 * 1000;
        const isWithinRange = fileDateMs >= (startDateMs - twoDaysMs) && fileDateMs <= (endDateMs + oneDayMs);
        
        console.log(`[IP REPORT DEBUG] > 24 hours: ${filePath} fileDate: ${fileDate.toISOString()}, range: ${startDate.toISOString()} - ${endDate.toISOString()}, relevant: ${isWithinRange}`);
        return isWithinRange;
    }

    /**
     * Download a file from remote server
     */
    async downloadFile(sshConnection, remotePath, projectId, environment) {
        const cacheDir = `/tmp/ip-report-cache/${projectId}-${environment}`;
        await fs.mkdir(cacheDir, { recursive: true });
        
        const fileName = path.basename(remotePath);
        const localPath = path.join(cacheDir, `${sshConnection.split('.')[0]}-${fileName}`);
        
        // Check if file exists and is recent (within 1 hour)
        let needsDownload = true;
        try {
            const stats = await fs.stat(localPath);
            const fileAge = Date.now() - stats.mtime.getTime();
            if (fileAge < 60 * 60 * 1000) { // 1 hour
                console.log(`[IP REPORT DEBUG] Using cached file: ${localPath}`);
                needsDownload = false;
            }
        } catch (err) {
            // File doesn't exist, need to download
        }
        
        if (needsDownload) {
            console.log(`[IP REPORT DEBUG] Downloading: ${remotePath} -> ${localPath}`);
            
            const downloadCommand = `scp -o ConnectTimeout=10 -o ServerAliveInterval=5 ${sshConnection}:${remotePath} ${localPath}`;
            await execAsync(downloadCommand, { timeout: 180000 }); // 3 minutes
            
            console.log(`[IP REPORT DEBUG] Download completed: ${localPath}`);
        }
        
        return localPath;
    }

    /**
     * Process a file and store logs in SQLite
     */
    async processAndStoreFile(filePath, projectId, environment, fileName, nodeNumber) {
        try {
            // Check if file has already been processed
            // Use node-specific filename to avoid conflicts between nodes
            const nodeSpecificFileName = `${nodeNumber}-${fileName}`;
            const isProcessed = await sqliteService.isFileProcessed(projectId, environment, nodeSpecificFileName);
            if (isProcessed) {
                console.log(`[IP REPORT DEBUG] File already processed, skipping: ${nodeSpecificFileName}`);
                // Clean up downloaded file
                await fs.unlink(filePath).catch(() => {});
                return 0;
            }

            console.log(`[IP REPORT DEBUG] Processing file: ${filePath}`);
            
            // Read and parse file - handle gzipped files
            let fileContent;
            if (filePath.endsWith('.gz')) {
                // Decompress gzipped file
                const compressedData = await fs.readFile(filePath);
                fileContent = gunzipSync(compressedData).toString('utf8');
                console.log(`[IP REPORT DEBUG] Decompressed gzipped file: ${filePath}`);
        } else {
                // Read regular file
                fileContent = await fs.readFile(filePath, 'utf8');
            }
            
            const lines = fileContent.split('\n').filter(line => line.trim());
            
            console.log(`[IP REPORT DEBUG] File contains ${lines.length} lines`);
            
            // Parse logs
            const parsedLogs = [];
            for (const line of lines) {
                const parsedLog = this.parseLogLine(line);
                if (parsedLog) {
                    parsedLog.fileSource = `${nodeNumber}-${fileName}`;
                    parsedLogs.push(parsedLog);
                }
            }
            
            console.log(`[IP REPORT DEBUG] Parsed ${parsedLogs.length} valid log entries`);
            
            // Store in SQLite
            const insertedCount = await sqliteService.insertLogs(parsedLogs, projectId, environment);
            
            // Mark file as processed
            await sqliteService.markFileAsProcessed(projectId, environment, nodeSpecificFileName);
            
            // Clean up downloaded file
            await fs.unlink(filePath).catch(() => {});
            
            return insertedCount;
            
            } catch (error) {
            console.error(`[IP REPORT ERROR] Error processing file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Parse a single log line
     */
    parseLogLine(line) {
        try {
            // Extract IP (first field)
            const ipMatch = line.match(/^([0-9.]+)/);
            if (!ipMatch) return null;
            const ip = ipMatch[1];

            // Extract timestamp [dd/Mon/yyyy:HH:mm:ss +zzzz]
            const timestampMatch = line.match(/\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
            let timestamp = null;
            if (timestampMatch) {
                const [, day, month, year, hour, minute, second] = timestampMatch;
                const monthMap = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                const monthNum = monthMap[month];
                if (monthNum !== undefined) {
                    // Create date in UTC to match the log timestamps
                    timestamp = new Date(Date.UTC(year, monthNum, day, hour, minute, second)).getTime();
                }
            }
            
            // If timestamp parsing failed, reject this log entry
            if (!timestamp) {
                return null;
            }

            // Extract HTTP status code
            const statusMatch = line.match(/"\s+(\d{3})\s+/);
            const status = statusMatch ? parseInt(statusMatch[1]) : null;

            // Extract HTTP method
            const methodMatch = line.match(/"([A-Z]+)\s/);
            const method = methodMatch ? methodMatch[1] : null;

            // Extract URL
            const urlMatch = line.match(/"\w+\s+([^\s]+)\s+HTTP/);
            const url = urlMatch ? urlMatch[1] : null;

            // Extract User Agent
            const userAgentMatch = line.match(/"([^"]*)"\s*$/);
            const userAgent = userAgentMatch ? userAgentMatch[1] : null;

            // Extract response size (bytes)
            const sizeMatch = line.match(/"\s+\d{3}\s+(\d+)\s+/);
            const responseSize = sizeMatch ? parseInt(sizeMatch[1]) : null;

            // Extract referrer (between quotes after status and size)
            const referrerMatch = line.match(/"\s+\d{3}\s+\d+\s+"([^"]*)"\s+"([^"]*)"\s*$/);
            const referrer = referrerMatch ? referrerMatch[1] : null;

            return {
                ip,
                timestamp: Math.floor(timestamp / 1000), // Convert to seconds for SQLite
                status,
                method,
                url,
                userAgent,
                responseSize,
                referrer,
                originalLine: line
            };

        } catch (error) {
            console.log(`[IP REPORT DEBUG] parseLogLine error: ${error.message}`);
            return null;
        }
    }

    /**
     * Calculate optimal bucket size for time series data
     */
    calculateOptimalBucketSize(timeRangeSeconds) {
        const timeRangeMinutes = timeRangeSeconds / 60;
        
        if (timeRangeMinutes <= 60) return 1; // 1-minute buckets for 1 hour
        if (timeRangeMinutes <= 720) return 7; // 7-minute buckets for 12 hours
        if (timeRangeMinutes <= 1440) return 15; // 15-minute buckets for 24 hours
        if (timeRangeMinutes <= 4320) return 45; // 45-minute buckets for 3 days
        if (timeRangeMinutes <= 10080) return 15; // 15-minute buckets for 7 days
        return 90; // 1.5-hour buckets for longer periods
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
export const ipReportService = new IpReportService();