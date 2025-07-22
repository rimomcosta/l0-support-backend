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
            console.log('[IP REPORT DEBUG] Starting generateIpReport with params:', {
                projectId, environment, options, userId: userId || 'undefined'
            });
            
            const { timeframe = 60, topIps = 20, from, to } = options;
            
            console.log('[IP REPORT DEBUG] Parsed options:', { timeframe, topIps, from, to });

            // Step 1: Get all nodes for the environment
            this.logger.info(`[IP REPORT] Getting nodes for ${projectId}/${environment}`);
            console.log('[IP REPORT DEBUG] About to get nodes...');
            this.sendProgress(wsService, userId, 'Getting available nodes...');
            
            const nodes = await this.getEnvironmentNodes(projectId, environment, apiToken, userId);
            console.log('[IP REPORT DEBUG] Got nodes:', nodes);
            this.logger.info(`[IP REPORT] Found ${nodes.length} nodes: ${nodes.join(', ')}`);
            this.sendProgress(wsService, userId, `Found ${nodes.length} nodes`);

            // Step 2: Collect access logs from all nodes
            this.logger.info(`[IP REPORT] Collecting access logs from all nodes`);
            console.log('[IP REPORT DEBUG] About to collect logs...');
            const allLogs = await this.collectAccessLogs(projectId, environment, nodes, apiToken, userId, wsService, { timeframe, from, to });
            console.log('[IP REPORT DEBUG] Collected logs count:', allLogs.length);
            this.logger.info(`[IP REPORT] Collected ${allLogs.length} log lines`);

            // Step 3: Parse logs (time filtering already done server-side)
            this.logger.info(`[IP REPORT] Parsing logs`);
            console.log('[IP REPORT DEBUG] About to parse logs...');
            this.sendProgress(wsService, userId, 'Aggregating locally...');
            
            const parsedLogs = this.parseLogLines(allLogs);
            console.log('[IP REPORT DEBUG] Parsed logs count:', parsedLogs.length);
            this.logger.info(`[IP REPORT] Parsed ${parsedLogs.length} relevant log entries`);

            // Check if this is a large dataset that needs memory-efficient processing
            const isLargeDataset = parsedLogs.length > 500000; // 500K+ logs
            console.log(`[IP REPORT DEBUG] Large dataset detected: ${isLargeDataset} (${parsedLogs.length} logs)`);

            let aggregatedData, topIpData, timeSeriesData, totalRequests;

            if (isLargeDataset) {
                // Memory-efficient processing for large datasets
                console.log('[IP REPORT DEBUG] Using memory-efficient processing...');
                
                // Calculate time range for bucket aggregation
                let wallAgo, wallUntil;
                if (from && to) {
                    const fromDate = new Date(from);
                    const toDate = new Date(to);
                    wallAgo = Math.floor(fromDate.getTime() / 1000);
                    wallUntil = Math.floor(toDate.getTime() / 1000);
                } else {
                    wallUntil = Math.floor(Date.now() / 1000);
                    wallAgo = wallUntil - (timeframe * 60);
                }
                
                // Get accurate totals without keeping all data in memory
                const totalsResult = this.getAccurateTotals(parsedLogs);
                aggregatedData = totalsResult.aggregatedData;
                totalRequests = totalsResult.totalRequests;
                
                // Get top IPs
                topIpData = this.getTopIps(aggregatedData, topIps);
                
                // Create time-series data for charts (aggregated by 1-minute buckets)
                timeSeriesData = this.aggregateByTimeBuckets(parsedLogs, wallAgo, wallUntil);
                
                // Clear parsed logs from memory
                parsedLogs.length = 0;
                
            } else {
                // Standard processing for smaller datasets
                console.log('[IP REPORT DEBUG] Using standard processing...');
                
                // Step 4: Aggregate data by IP
                this.logger.info(`[IP REPORT] Aggregating data by IP`);
                console.log('[IP REPORT DEBUG] About to aggregate...');
                aggregatedData = this.aggregateByIp(parsedLogs);
                console.log('[IP REPORT DEBUG] Aggregated data keys:', Object.keys(aggregatedData).length);
                
                // Step 5: Sort and limit results
                console.log('[IP REPORT DEBUG] About to get top IPs...');
                topIpData = this.getTopIps(aggregatedData, topIps);
                console.log('[IP REPORT DEBUG] Top IP data count:', topIpData.length);
                
                totalRequests = parsedLogs.length;
            }
            
            const processingTime = Date.now() - startTime;
            this.logger.info(`[IP REPORT] Report generated successfully in ${processingTime}ms`);

            // Format output exactly like bash script
            console.log('[IP REPORT DEBUG] About to format output...');
            const formattedOutput = this.formatOutputLikeBashScript(topIpData);
            console.log('[IP REPORT DEBUG] Formatted output length:', formattedOutput.length);
            
            const result = {
                success: true,
                data: {
                    summary: {
                        totalRequests: totalRequests,
                        uniqueIps: Object.keys(aggregatedData).length,
                        topIpsShown: topIpData.length,
                        timeRange: this.getTimeRangeInfo(from, to, timeframe),
                        processingTimeMs: processingTime,
                        isLargeDataset: isLargeDataset
                    },
                    ips: topIpData,
                    rawOutput: formattedOutput, // Raw format like bash script
                    timeSeriesData: timeSeriesData, // Aggregated time-series data for charts
                    reportId: `${projectId}-${environment}-${Date.now()}` // For caching
                }
            };
            
            console.log('[IP REPORT DEBUG] Returning result with success:', result.success);
            return result;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.logger.error(`[IP REPORT] Failed to generate report after ${processingTime}ms:`, error);
            console.error('[IP REPORT] Service error:', error);
            console.error('[IP REPORT] Stack trace:', error.stack);
            
            const errorResult = {
                success: false,
                error: error.message,
                processingTimeMs: processingTime
            };
            
            console.log('[IP REPORT DEBUG] Returning error result:', errorResult);
            return errorResult;
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
    async collectAccessLogs(projectId, environment, nodes, apiToken, userId, wsService = null, options = {}) {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const fs = await import('fs/promises');
            const path = await import('path');
            const execAsync = promisify(exec);
            
            const { timeframe = 60, from, to } = options;
            
            console.log('[IP REPORT DEBUG] Starting log collection from', nodes.length, 'nodes using local file strategy');
            console.log('[IP REPORT DEBUG] Options:', options);
            
            // Calculate time range for filtering - use exact user time range
            let wallAgo, wallUntil;
            if (from && to) {
                // Parse user's exact time range - assume UTC format
                const fromDate = new Date(from);
                const toDate = new Date(to);
                
                if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
                    throw new Error('Invalid date format provided');
                }
                
                // Convert to UTC epoch timestamps
                wallAgo = Math.floor(fromDate.getTime() / 1000);
                wallUntil = Math.floor(toDate.getTime() / 1000);
                
                console.log(`[IP REPORT DEBUG] User specified time range: ${from} to ${to}`);
                console.log(`[IP REPORT DEBUG] Converted to epoch: ${wallAgo} to ${wallUntil}`);
                console.log(`[IP REPORT DEBUG] Epoch to readable: ${new Date(wallAgo * 1000).toISOString()} to ${new Date(wallUntil * 1000).toISOString()}`);
                console.log(`[IP REPORT DEBUG] User timezone offset: ${fromDate.getTimezoneOffset()} minutes`);
                console.log(`[IP REPORT DEBUG] From date local: ${fromDate.toString()}`);
                console.log(`[IP REPORT DEBUG] To date local: ${toDate.toString()}`);
            } else if (timeframe === 0) {
                // All logs
                wallAgo = 0;
                wallUntil = Math.floor(Date.now() / 1000);
            } else {
                // Timeframe in minutes from now
                wallUntil = Math.floor(Date.now() / 1000);
                wallAgo = wallUntil - (timeframe * 60);
            }
            
            console.log(`[IP REPORT DEBUG] Final time range: ${wallAgo} to ${wallUntil}`);
            console.log(`[IP REPORT DEBUG] Time range readable: ${new Date(wallAgo * 1000).toISOString()} to ${new Date(wallUntil * 1000).toISOString()}`);
            
            // Create cache directory
            const cacheDir = `/tmp/ip-report-cache/${projectId}-${environment}`;
            await fs.mkdir(cacheDir, { recursive: true });
            
            // Check if we can use cached data for this timeframe
            const cachedResult = await this.checkCachedTimeframe(cacheDir, wallAgo, wallUntil);
            if (cachedResult.canUseCached) {
                console.log(`[IP REPORT DEBUG] Using cached data - no new downloads needed`);
                console.log(`[IP REPORT DEBUG] Relevant cached files: ${cachedResult.files.length} files`);
                // Only process files that actually overlap with our timeframe
                const relevantFiles = await this.filterRelevantFiles(cachedResult.files, wallAgo, wallUntil);
                console.log(`[IP REPORT DEBUG] After filtering by timeframe: ${relevantFiles.length} files`);
                return await this.processLocalLogFiles(relevantFiles, wallAgo, wallUntil);
            }
            
            // Step 1: Collect all relevant files from all nodes
            const allLocalFiles = [];
            
            for (let i = 0; i < nodes.length; i++) {
                const sshConnection = nodes[i];
                const nodeNumber = sshConnection.split('.')[0];
                console.log(`[IP REPORT DEBUG] Processing node ${i + 1}/${nodes.length}: ${nodeNumber}`);
                this.logger.info(`[IP REPORT] Collecting logs from SSH connection: ${sshConnection}`);
                
                // Send progress update
                this.sendProgress(wsService, userId, `Scanning node ${nodeNumber}...`);
                
                try {
                    // Get list of all log files with dates
                    console.log(`[IP REPORT DEBUG] Getting log file list from ${nodeNumber}`);
                    const fileListCommand = `ssh -T ${sshConnection} "ls -lah /var/log/platform/*/access.log*"`;
                    const { stdout: fileList } = await execAsync(fileListCommand, { timeout: 30000 });
                    
                    // Smart pre-filtering based on file dates
                    const candidateFiles = this.preFilterLogFiles(fileList, wallAgo, wallUntil);
                    console.log(`[IP REPORT DEBUG] Pre-filtered candidate files for ${nodeNumber}:`, candidateFiles);
                    
                    if (candidateFiles.length === 0) {
                        console.log(`[IP REPORT DEBUG] No candidate files found for ${nodeNumber}`);
                        continue;
                    }
                    
                    // Download relevant files locally (with caching)
                    for (const remoteFile of candidateFiles) {
                        const fileName = path.basename(remoteFile);
                        const localPath = path.join(cacheDir, `${nodeNumber}-${fileName}`);
                        
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
                            this.sendProgress(wsService, userId, `Downloading ${fileName} from node ${nodeNumber}...`);
                            const downloadCommand = `scp ${sshConnection}:${remoteFile} ${localPath}`;
                            await execAsync(downloadCommand, { timeout: 180000 }); // 3 minutes
                            console.log(`[IP REPORT DEBUG] Downloaded: ${remoteFile} -> ${localPath}`);
                        }
                        
                        allLocalFiles.push(localPath);
                    }
                    
                } catch (nodeError) {
                    console.error(`[IP REPORT DEBUG] Error processing node ${nodeNumber}:`, nodeError.message);
                    this.logger.error(`[IP REPORT] Error processing node ${nodeNumber}:`, nodeError.message);
                    // Continue with other nodes
                }
            }
            
            // Step 2: Process all files from all nodes together
            this.sendProgress(wsService, userId, `Merging logs from all nodes...`);
            console.log(`[IP REPORT DEBUG] Processing ${allLocalFiles.length} files from all ${nodes.length} nodes`);
            
            const allLogs = await this.processLocalLogFiles(allLocalFiles, wallAgo, wallUntil);
            
            // Clean up old cache files (older than 6 hours)
            this.cleanupCacheFiles(cacheDir, 6 * 60 * 60 * 1000);
            
            console.log(`[IP REPORT DEBUG] Total logs collected: ${allLogs.length}`);
            return allLogs;
        } catch (error) {
            console.error(`[IP REPORT DEBUG] Error in collectAccessLogs:`, error);
            this.logger.error(`[IP REPORT] Error collecting access logs:`, error);
            throw error;
        }
    }

    /**
     * Process downloaded log files locally with precise time filtering
     */
    async processLocalLogFiles(localFiles, wallAgo, wallUntil) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const fs = await import('fs/promises');
        const execAsync = promisify(exec);
        
        console.log(`[IP REPORT DEBUG] Processing ${localFiles.length} local files - simple merge approach`);
        console.log(`[IP REPORT DEBUG] Time range: ${new Date(wallAgo * 1000).toISOString()} to ${new Date(wallUntil * 1000).toISOString()}`);
        
        // Step 1: Merge all files into one
        const mergedFile = `/tmp/ip-report-cache/merged-${Date.now()}.txt`;
        console.log(`[IP REPORT DEBUG] Merging files into: ${mergedFile}`);
        
        for (const filePath of localFiles) {
            try {
                const stats = await fs.stat(filePath);
                if (stats.size === 0) continue;
                
                const isGzipped = filePath.endsWith('.gz');
                const cmd = isGzipped ? `gzip -dc "${filePath}" >> "${mergedFile}"` : `cat "${filePath}" >> "${mergedFile}"`;
                
                console.log(`[IP REPORT DEBUG] Merging ${filePath} (${stats.size} bytes)`);
                await execAsync(cmd, { timeout: 60000 });
            } catch (err) {
                console.error(`[IP REPORT DEBUG] Error merging ${filePath}:`, err.message);
            }
        }
        
        // Step 2: Check merged file
        try {
            const mergedStats = await fs.stat(mergedFile);
            console.log(`[IP REPORT DEBUG] Merged file: ${mergedStats.size} bytes`);
            
            if (mergedStats.size === 0) {
                await fs.unlink(mergedFile).catch(() => {});
                return [];
            }
            
            // Step 3: Filter merged file and save to output file
            const outputFile = `/tmp/ip-report-cache/filtered-${Date.now()}.txt`;
            console.log(`[IP REPORT DEBUG] Filtering merged file to: ${outputFile}`);
            
            // Quick debug check on a few lines
            console.log(`[IP REPORT DEBUG] Testing filter with first few lines...`);
            try {
                const { stdout: sampleLines } = await execAsync(`head -3 "${mergedFile}"`, { timeout: 10000 });
                console.log(`[IP REPORT DEBUG] Sample lines:`, sampleLines.split('\n').slice(0, 2));
            } catch (debugErr) {
                console.log(`[IP REPORT DEBUG] Sample error:`, debugErr.message);
            }

            // Create a temporary awk script file to avoid escaping issues
            const awkScript = `/tmp/ip-report-cache/filter-${Date.now()}.awk`;
            const awkContent = `BEGIN {
    split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", M, " ")
    for(m=1; m<=12; m++) mon[M[m]] = m
    wall_ago = ${wallAgo}
    wall_until = ${wallUntil}
    print "DEBUG: wall_ago = " wall_ago " (" strftime("%Y-%m-%d %H:%M:%S", wall_ago) ")"
    print "DEBUG: wall_until = " wall_until " (" strftime("%Y-%m-%d %H:%M:%S", wall_until) ")"
    processed = 0
    matched = 0
}
{
    processed++
    # Match the timestamp format: [dd/Mon/yyyy:HH:mm:ss +zzzz]
    if (match($0, "\\\\[([0-9]{2})/([A-Za-z]{3})/([0-9]{4}):([0-9]{2}):([0-9]{2}):([0-9]{2})", t)) {
        # mktime() treats the timestamp as local time, so we need to adjust for timezone
        # The logs show UTC (+0000), so we don't need to adjust
        ts = mktime(t[3]" "mon[t[2]]" "t[1]" "t[4]" "t[5]" "t[6])
        if (ts >= wall_ago && ts <= wall_until) {
            print $0
            matched++
        }
    }
    if (processed <= 5) {
        print "DEBUG: Line " processed " - timestamp: " t[1] "/" t[2] "/" t[3] " " t[4] ":" t[5] ":" t[6] " -> epoch: " ts " (in range: " (ts >= wall_ago && ts <= wall_until) ")"
    }
}
END {
    print "DEBUG: Processed " processed " lines, matched " matched " lines"
}`;
            
            await fs.writeFile(awkScript, awkContent);
            console.log(`[IP REPORT DEBUG] Created awk script: ${awkScript}`);
            
            const filterCmd = `gawk -f "${awkScript}" "${mergedFile}" > "${outputFile}"`;
            console.log(`[IP REPORT DEBUG] Executing filter command: ${filterCmd}`);
            
            try {
                const result = await execAsync(filterCmd, {
                    timeout: 300000, // 5 minutes
                    maxBuffer: 10 * 1024 * 1024 // Small buffer since output goes to file
                });
                console.log(`[IP REPORT DEBUG] Filter command completed successfully`);
                if (result.stderr) {
                    console.log(`[IP REPORT DEBUG] Filter stderr: ${result.stderr}`);
                }
            } catch (filterError) {
                console.log(`[IP REPORT DEBUG] Filter command failed: ${filterError.message}`);
                if (filterError.stderr) {
                    console.log(`[IP REPORT DEBUG] Filter error stderr: ${filterError.stderr}`);
                }
                // Clean up awk script
                await fs.unlink(awkScript).catch(() => {});
                throw filterError;
            }
            
            // Clean up awk script
            await fs.unlink(awkScript).catch(() => {});
            
            // Step 4: Count lines and read file safely
            console.log(`[IP REPORT DEBUG] About to count lines in: ${outputFile}`);
            let totalLines = 0;
            try {
                const { stdout: lineCount, stderr: countStderr } = await execAsync(`wc -l "${outputFile}"`, { timeout: 30000 });
                console.log(`[IP REPORT DEBUG] wc -l stdout: "${lineCount}"`);
                if (countStderr) console.log(`[IP REPORT DEBUG] wc -l stderr: "${countStderr}"`);
                
                // Parse the wc -l output properly - it returns "  650618 /tmp/ip-report-cache/filtered-1753198982560.txt"
                const lineCountMatch = lineCount.trim().match(/^\s*(\d+)\s+/);
                if (lineCountMatch) {
                    totalLines = parseInt(lineCountMatch[1]);
                } else {
                    console.log(`[IP REPORT DEBUG] Failed to parse wc -l output: "${lineCount}"`);
                    totalLines = 0;
                }
                
                console.log(`[IP REPORT DEBUG] Parsed totalLines: ${totalLines}`);
                console.log(`[IP REPORT DEBUG] Filtered result: ${totalLines} lines`);
            } catch (countError) {
                console.log(`[IP REPORT DEBUG] wc -l command failed: ${countError.message}`);
                throw countError;
            }
            
            // Read file content safely without split() to avoid stack overflow
            const lines = [];
            if (totalLines > 0) {
                console.log(`[IP REPORT DEBUG] Reading ${totalLines} lines from ${outputFile}`);
                
                // Use readline approach to avoid memory issues with large files
                const { createReadStream } = await import('fs');
                const { createInterface } = await import('readline');
                
                const fileStream = createReadStream(outputFile);
                const rl = createInterface({
                    input: fileStream,
                    crlfDelay: Infinity
                });
                
                let lineCount = 0;
                for await (const line of rl) {
                    if (line.trim()) {
                        lines.push(line.trim());
                        lineCount++;
                        if (lineCount <= 3) {
                            console.log(`[IP REPORT DEBUG] Line ${lineCount}: ${line.substring(0, 100)}`);
                        }
                    }
                }
                
                console.log(`[IP REPORT DEBUG] Actually read ${lines.length} lines from file`);
                console.log(`[IP REPORT DEBUG] First few lines:`, lines.slice(0, 3));
                
                // Test parseLogLine with first line
                if (lines.length > 0) {
                    console.log(`[IP REPORT DEBUG] Testing parseLogLine with first line:`, lines[0]);
                    const testResult = this.parseLogLine(lines[0]);
                    console.log(`[IP REPORT DEBUG] parseLogLine result:`, testResult);
                }
                
                rl.close();
                fileStream.close();
            } else {
                console.log(`[IP REPORT DEBUG] No lines to read (totalLines: ${totalLines})`);
            }
            
            if (lines.length > 0) {
                const firstTs = this.extractTimestampFromLogLine(lines[0]);
                const lastTs = this.extractTimestampFromLogLine(lines[lines.length - 1]);
                
                if (firstTs && lastTs) {
                    console.log(`[IP REPORT DEBUG] Time span: ${new Date(firstTs * 1000).toISOString()} to ${new Date(lastTs * 1000).toISOString()}`);
                    console.log(`[IP REPORT DEBUG] Duration: ${((lastTs - firstTs) / 3600).toFixed(1)} hours`);
                }
            }
            
            // Step 5: Cleanup temporary files (temporarily disabled for debugging)
            console.log(`[IP REPORT DEBUG] NOT cleaning up files for debugging - mergedFile: ${mergedFile}, outputFile: ${outputFile}`);
            // await fs.unlink(mergedFile).catch(() => {});
            // await fs.unlink(outputFile).catch(() => {});
            return lines;
            
        } catch (error) {
            console.error(`[IP REPORT DEBUG] Filter error:`, error.message);
            console.error(`[IP REPORT DEBUG] Error stack:`, error.stack);
            // Clean up on error
            await fs.unlink(mergedFile).catch(() => {});
            console.log(`[IP REPORT DEBUG] Returning empty array due to error`);
            return [];
        }
    }

    /**
     * Extract timestamp from a log line
     */
    extractTimestampFromLogLine(logLine) {
        if (!logLine) return null;
        
        // Match Apache log format: [16/Jul/2025:03:00:05 +0000]
        const match = logLine.match(/\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
        if (!match) return null;
        
        const [, day, month, year, hour, minute, second] = match;
        const monthMap = {
            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
        };
        
        const monthNum = monthMap[month];
        if (!monthNum) return null;
        
        // Create date and return as epoch timestamp
        const date = new Date(Date.UTC(parseInt(year), monthNum - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second)));
        return Math.floor(date.getTime() / 1000);
    }

    /**
     * Check if cached files can cover the requested timeframe
     */
    async checkCachedTimeframe(cacheDir, wallAgo, wallUntil) {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            
            // Get all cached .gz files
            const files = await fs.readdir(cacheDir);
            const logFiles = files.filter(f => f.endsWith('.gz'));
            
            if (logFiles.length === 0) {
                return { canUseCached: false, files: [] };
            }
            
            // For each cached file, check what timeframe it covers
            const fileTimeframes = [];
            for (const file of logFiles) {
                const filePath = path.join(cacheDir, file);
                const timeframe = await this.getFileTimeframe(filePath);
                if (timeframe) {
                    fileTimeframes.push({ file: filePath, ...timeframe });
                }
            }
            
            // Check if the combined cached files cover the requested timeframe
            if (fileTimeframes.length === 0) {
                return { canUseCached: false, files: [] };
            }
            
            const minCachedTime = Math.min(...fileTimeframes.map(f => f.startTime));
            const maxCachedTime = Math.max(...fileTimeframes.map(f => f.endTime));
            
            const canUseCached = wallAgo >= minCachedTime && wallUntil <= maxCachedTime;
            
            console.log(`[IP REPORT DEBUG] Cache check: requested ${wallAgo}-${wallUntil}, cached ${minCachedTime}-${maxCachedTime}, canUse: ${canUseCached}`);
            
            return {
                canUseCached,
                files: canUseCached ? fileTimeframes.map(f => f.file) : []
            };
            
        } catch (error) {
            console.log(`[IP REPORT DEBUG] Cache check error:`, error.message);
            return { canUseCached: false, files: [] };
        }
    }
    
    /**
     * Filter cached files to only include those that overlap with the requested timeframe
     */
    async filterRelevantFiles(files, wallAgo, wallUntil) {
        const relevantFiles = [];
        
        for (const filePath of files) {
            const timeframe = await this.getFileTimeframe(filePath);
            if (timeframe) {
                // Check if file overlaps with requested timeframe
                const hasOverlap = !(timeframe.endTime < wallAgo || timeframe.startTime > wallUntil);
                if (hasOverlap) {
                    console.log(`[IP REPORT DEBUG] File ${filePath} overlaps: ${timeframe.startTime}-${timeframe.endTime} vs ${wallAgo}-${wallUntil}`);
                    relevantFiles.push(filePath);
                } else {
                    console.log(`[IP REPORT DEBUG] File ${filePath} no overlap: ${timeframe.startTime}-${timeframe.endTime} vs ${wallAgo}-${wallUntil}`);
                }
            }
        }
        
        return relevantFiles;
    }

    /**
     * Get the timeframe covered by a log file by checking first and last lines
     */
    async getFileTimeframe(filePath) {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            
            // Get first and last line timestamps
            const firstCmd = `gzip -dc "${filePath}" | head -1`;
            const lastCmd = `gzip -dc "${filePath}" | tail -1`;
            
            const [firstResult, lastResult] = await Promise.all([
                execAsync(firstCmd, { timeout: 10000 }),
                execAsync(lastCmd, { timeout: 10000 })
            ]);
            
            const startTime = this.extractTimestampFromLogLine(firstResult.stdout.trim());
            const endTime = this.extractTimestampFromLogLine(lastResult.stdout.trim());
            
            if (startTime && endTime) {
                return { startTime, endTime };
            }
            
            return null;
        } catch (error) {
            console.log(`[IP REPORT DEBUG] Error getting timeframe for ${filePath}:`, error.message);
            return null;
        }
    }

    /**
     * Clean up old cache files
     */
    async cleanupCacheFiles(cacheDir, maxAge) {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            
            const files = await fs.readdir(cacheDir);
            const now = Date.now();
            
            for (const file of files) {
                const filePath = path.join(cacheDir, file);
                const stats = await fs.stat(filePath);
                const age = now - stats.mtime.getTime();
                
                if (age > maxAge) {
                    await fs.unlink(filePath);
                    console.log(`[IP REPORT DEBUG] Cleaned up old cache file: ${filePath}`);
                }
            }
        } catch (error) {
            console.log(`[IP REPORT DEBUG] Cache cleanup error (non-critical):`, error.message);
        }
    }

    /**
     * Smart pre-filtering of log files based on file modification dates
     */
    preFilterLogFiles(fileListOutput, wallAgo, wallUntil) {
        const lines = fileListOutput.split('\n').filter(line => line.trim());
        const candidateFiles = [];
        
        // Convert epoch times to dates for comparison
        const startDate = new Date(wallAgo * 1000);
        const endDate = new Date(wallUntil * 1000);
        
        console.log(`[IP REPORT DEBUG] Looking for files between ${startDate.toISOString()} and ${endDate.toISOString()}`);
        
        // Parse file information with timestamps
        for (const line of lines) {
            // Parse ls -lah output: permissions, links, user, group, size, month, day, time/year, path
            // Example: -rw-r--r-- 1 ykcmext77rk4s ykcmext77rk4s 8.5M Jul 22 13:40 /var/log/platform/ykcmext77rk4s/access.log
            const match = line.match(/.*\s+([A-Za-z]{3})\s+(\d{1,2})\s+([\d:]+)\s+(\S+\/access\.log.*?)$/);
            if (match) {
                const [, monthStr, dayStr, timeStr, filePath] = match;
                
                const monthMap = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                
                const currentYear = new Date().getFullYear();
                const fileMonth = monthMap[monthStr];
                const fileDay = parseInt(dayStr);
                
                if (fileMonth !== undefined) {
                    // Parse time to determine if it's this year or last year
                    let fileYear = currentYear;
                    
                    // If the file date is in the future relative to now, it's probably from last year
                    const fileDate = new Date(fileYear, fileMonth, fileDay);
                    const now = new Date();
                    if (fileDate > now) {
                        fileYear = currentYear - 1;
                    }
                    
                    const finalFileDate = new Date(fileYear, fileMonth, fileDay);
                    
                    // Add buffer of 1 day on each side to catch edge cases
                    const bufferMs = 24 * 60 * 60 * 1000; // 1 day
                    const rangeStart = new Date(startDate.getTime() - bufferMs);
                    const rangeEnd = new Date(endDate.getTime() + bufferMs);
                    
                    if (finalFileDate >= rangeStart && finalFileDate <= rangeEnd) {
                        candidateFiles.push(filePath);
                        console.log(`[IP REPORT DEBUG] Including file: ${filePath} (${finalFileDate.toDateString()})`);
                    } else {
                        console.log(`[IP REPORT DEBUG] Skipping file: ${filePath} (${finalFileDate.toDateString()}) outside range`);
                    }
                }
            }
        }
        
        // Always include the current access.log if no candidates found
        if (candidateFiles.length === 0) {
            const currentLogMatch = fileListOutput.match(/(\S+\/access\.log)$/m);
            if (currentLogMatch) {
                candidateFiles.push(currentLogMatch[1]);
                console.log(`[IP REPORT DEBUG] No candidates found, including current log: ${currentLogMatch[1]}`);
            }
        }
        
        return candidateFiles;
    }

    /**
     * Parse log lines into structured data (no time filtering - done server-side)
     */
    parseLogLines(logs) {
        const parsedLogs = [];
        
        console.log(`[IP REPORT DEBUG] parseLogLines called with ${logs.length} lines`);
        
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
        
        console.log(`[IP REPORT DEBUG] parseLogLines returned ${parsedLogs.length} parsed entries`);
        
        // Debug first few lines if we have any
        if (parsedLogs.length > 0) {
            console.log(`[IP REPORT DEBUG] First parsed entry:`, parsedLogs[0]);
        } else if (logs.length > 0) {
            console.log(`[IP REPORT DEBUG] First raw line (failed to parse):`, logs[0]);
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
            if (!ipMatch) {
                console.log(`[IP REPORT DEBUG] parseLogLine: No IP match for line: ${line.substring(0, 100)}`);
                return null;
            }
            const ip = ipMatch[1];

            // Extract timestamp [dd/Mon/yyyy:HH:mm:ss
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
                    // Date constructor expects 0-based month, so monthNum is correct
                    timestamp = new Date(year, monthNum, day, hour, minute, second).getTime();
                } else {
                    console.log(`[IP REPORT DEBUG] parseLogLine: Invalid month '${month}' for line: ${line.substring(0, 100)}`);
                }
            } else {
                console.log(`[IP REPORT DEBUG] parseLogLine: No timestamp match for line: ${line.substring(0, 100)}`);
            }

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
                timestamp,
                originalLine: line
            };

        } catch (error) {
            console.log(`[IP REPORT DEBUG] parseLogLine error: ${error.message} for line: ${line.substring(0, 100)}`);
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
            
            // Get top URLs (limit to top 10)
            ipData.topUrlsList = this.getTopEntries(ipData.topUrls, 10);
            
            // Get all user agents as a list
            ipData.userAgentsList = this.getTopEntries(ipData.userAgents, 20);
        }

        return aggregated;
    }

    /**
     * Aggregate logs by time buckets to reduce memory usage for large datasets
     * This creates 1-minute interval buckets for time-series charts
     */
    aggregateByTimeBuckets(logs, wallAgo, wallUntil) {
        console.log('[IP REPORT DEBUG] Aggregating logs by time buckets...');
        
        // Create 1-minute buckets
        const bucketSize = 60; // 1 minute in seconds
        const buckets = new Map();
        
        // Initialize buckets for the entire time range
        for (let timestamp = wallAgo; timestamp <= wallUntil; timestamp += bucketSize) {
            const bucketKey = Math.floor(timestamp / bucketSize) * bucketSize;
            buckets.set(bucketKey, {
                timestamp: bucketKey,
                ipCounts: new Map(), // IP -> count for this bucket
                totalRequests: 0
            });
        }
        
        console.log(`[IP REPORT DEBUG] Created ${buckets.size} time buckets`);
        
        // Process logs in chunks to avoid memory issues
        const chunkSize = 10000;
        let processedCount = 0;
        
        for (let i = 0; i < logs.length; i += chunkSize) {
            const chunk = logs.slice(i, i + chunkSize);
            
            for (const log of chunk) {
                const logTimestamp = Math.floor(log.timestamp / 1000);
                const bucketKey = Math.floor(logTimestamp / bucketSize) * bucketSize;
                
                if (buckets.has(bucketKey)) {
                    const bucket = buckets.get(bucketKey);
                    bucket.totalRequests++;
                    
                    // Count by IP for this bucket
                    bucket.ipCounts.set(log.ip, (bucket.ipCounts.get(log.ip) || 0) + 1);
                }
            }
            
            processedCount += chunk.length;
            if (processedCount % 100000 === 0) {
                console.log(`[IP REPORT DEBUG] Processed ${processedCount}/${logs.length} logs`);
            }
        }
        
        console.log(`[IP REPORT DEBUG] Completed time bucket aggregation for ${logs.length} logs`);
        
        // Convert to array format for frontend
        const timeSeriesData = Array.from(buckets.values()).map(bucket => ({
            timestamp: bucket.timestamp,
            totalRequests: bucket.totalRequests,
            ipCounts: Object.fromEntries(bucket.ipCounts)
        }));
        
        return timeSeriesData;
    }

    /**
     * Get accurate totals from all logs without keeping them all in memory
     */
    getAccurateTotals(logs) {
        console.log('[IP REPORT DEBUG] Calculating accurate totals...');
        
        const ipTotals = new Map();
        let totalRequests = 0;
        
        // Process in chunks to avoid memory issues
        const chunkSize = 10000;
        
        for (let i = 0; i < logs.length; i += chunkSize) {
            const chunk = logs.slice(i, i + chunkSize);
            
            for (const log of chunk) {
                totalRequests++;
                ipTotals.set(log.ip, (ipTotals.get(log.ip) || 0) + 1);
            }
            
            if ((i + chunkSize) % 100000 === 0) {
                console.log(`[IP REPORT DEBUG] Processed ${i + chunkSize}/${logs.length} logs for totals`);
            }
        }
        
        // Convert to aggregated format
        const aggregatedData = {};
        for (const [ip, totalHits] of ipTotals) {
            aggregatedData[ip] = {
                ip,
                totalHits,
                statusCodes: {},
                methods: {},
                userAgents: {}
            };
        }
        
        console.log(`[IP REPORT DEBUG] Calculated totals: ${totalRequests} requests, ${ipTotals.size} unique IPs`);
        
        return { aggregatedData, totalRequests };
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