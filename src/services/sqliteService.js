import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { logger } from './logger.js';
import path from 'path';
import fs from 'fs/promises';

export class SQLiteService {
    constructor() {
        this.databases = new Map(); // Cache for database connections
        this.logger = logger;
    }

    /**
     * Get or create database connection for a project
     */
    async getDatabase(projectId, environment) {
        const dbKey = `${projectId}-${environment}`;
        
        if (this.databases.has(dbKey)) {
            return this.databases.get(dbKey);
        }

        const dbPath = `/tmp/access_logs-${dbKey}.db`;
        console.log(`[SQLITE DEBUG] Opening database: ${dbPath}`);
        
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error(`[SQLITE ERROR] Failed to open database ${dbPath}:`, err);
                throw err;
            }
            console.log(`[SQLITE DEBUG] Connected to database: ${dbPath}`);
        });

        // Enable WAL mode for better concurrency
        await this.runQuery(db, 'PRAGMA journal_mode = WAL');
        
        // Maximum performance optimizations for parallel processing
        await this.runQuery(db, 'PRAGMA synchronous = OFF'); // Fastest writes
        await this.runQuery(db, 'PRAGMA cache_size = 20000'); // Very large cache
        await this.runQuery(db, 'PRAGMA temp_store = MEMORY'); // Use memory for temp storage
        await this.runQuery(db, 'PRAGMA mmap_size = 536870912'); // 512MB memory mapping
        await this.runQuery(db, 'PRAGMA page_size = 65536'); // Larger page size
        await this.runQuery(db, 'PRAGMA locking_mode = EXCLUSIVE'); // Exclusive locking for better performance
        await this.runQuery(db, 'PRAGMA journal_mode = DELETE'); // Faster than WAL for bulk inserts
        
        // Create tables if they don't exist
        await this.initializeTables(db);
        
        this.databases.set(dbKey, db);
        return db;
    }

    /**
     * Initialize database tables
     */
    async initializeTables(db) {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                environment TEXT NOT NULL,
                ip TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                status_code INTEGER,
                method TEXT,
                url TEXT,
                user_agent TEXT,
                response_size INTEGER,
                referrer TEXT,
                original_line TEXT,
                file_source TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(project_id, environment, ip, timestamp, status_code, method, url, user_agent, response_size, referrer, original_line, file_source)
            )
        `;

        const createProcessedFilesTableSQL = `
            CREATE TABLE IF NOT EXISTS processed_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                environment TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size INTEGER,
                processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(project_id, environment, file_name)
            )
        `;

        const createIndexesSQL = [
            'CREATE INDEX IF NOT EXISTS idx_project_env ON access_logs(project_id, environment)',
            'CREATE INDEX IF NOT EXISTS idx_ip_timestamp ON access_logs(ip, timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_timestamp ON access_logs(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_ip ON access_logs(ip)',
            'CREATE INDEX IF NOT EXISTS idx_status_code ON access_logs(status_code)',
            'CREATE INDEX IF NOT EXISTS idx_method ON access_logs(method)'
        ];

        try {
            await this.runQuery(db, createTableSQL);
            await this.runQuery(db, createProcessedFilesTableSQL);
            
            for (const indexSQL of createIndexesSQL) {
                await this.runQuery(db, indexSQL);
            }
            
            console.log('[SQLITE DEBUG] Tables and indexes initialized successfully');
        } catch (error) {
            console.error('[SQLITE ERROR] Failed to initialize tables:', error);
            throw error;
        }
    }

    /**
     * Run a query and return results
     */
    async runQuery(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('[SQLITE ERROR] Query failed:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Run a query and return single result
     */
    async runQuerySingle(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) {
                    console.error('[SQLITE ERROR] Query failed:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    /**
     * Run a query and return the number of affected rows
     */
    async runQueryAffected(db, sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) {
                    console.error('[SQLITE ERROR] Query failed:', err);
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    /**
     * Check if a file has been processed
     */
    async isFileProcessed(projectId, environment, fileName) {
        const db = await this.getDatabase(projectId, environment);
        
        const result = await this.runQuerySingle(db, `
            SELECT id FROM processed_files 
            WHERE project_id = ? AND environment = ? AND file_name = ?
        `, [projectId, environment, fileName]);
        
        return !!result;
    }

    /**
     * Mark a file as processed
     */
    async markFileAsProcessed(projectId, environment, fileName, fileSize = null) {
        const db = await this.getDatabase(projectId, environment);
        
        await this.runQueryAffected(db, `
            INSERT OR IGNORE INTO processed_files 
            (project_id, environment, file_name, file_size) 
            VALUES (?, ?, ?, ?)
        `, [projectId, environment, fileName, fileSize]);
        
        console.log(`[SQLITE DEBUG] Marked file as processed: ${fileName}`);
    }

    /**
     * Insert logs in batches for efficiency
     */
    async insertLogs(logs, projectId, environment) {
        if (!logs || logs.length === 0) {
            console.log('[SQLITE DEBUG] No logs to insert');
            return 0;
        }

        const db = await this.getDatabase(projectId, environment);
        const batchSize = 2500; // Maximum batch size for optimal performance
        let totalInserted = 0;

        console.log(`[SQLITE DEBUG] Inserting ${logs.length} logs in batches of ${batchSize}`);

        try {
            // Start transaction for better performance
            await this.runQuery(db, 'BEGIN TRANSACTION');

            for (let i = 0; i < logs.length; i += batchSize) {
                const batch = logs.slice(i, i + batchSize);
                const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
                
                const sql = `
                    INSERT OR IGNORE INTO access_logs 
                    (project_id, environment, ip, timestamp, status_code, method, url, user_agent, response_size, referrer, original_line, file_source)
                    VALUES ${placeholders}
                `;

                const params = batch.flatMap(log => [
                    projectId,
                    environment,
                    log.ip,
                    log.timestamp,
                    log.status || null,
                    log.method || null,
                    log.url || null,
                    log.userAgent || null,
                    log.responseSize || null,
                    log.referrer || null,
                    log.originalLine || null,
                    log.fileSource || null
                ]);

                const affected = await this.runQueryAffected(db, sql, params);
                totalInserted += affected;
                
                if (i % 10000 === 0) {
                    console.log(`[SQLITE DEBUG] Inserted ${totalInserted} logs so far (${Math.round((i / logs.length) * 100)}%)`);
                }
            }

            // Commit transaction
            await this.runQuery(db, 'COMMIT');
            console.log(`[SQLITE DEBUG] Total logs inserted: ${totalInserted} (${logs.length} attempted)`);
            
        } catch (error) {
            // Rollback on error
            try {
                await this.runQuery(db, 'ROLLBACK');
            } catch (rollbackError) {
                console.error('[SQLITE ERROR] Rollback failed:', rollbackError);
            }
            console.error('[SQLITE ERROR] Batch insert failed:', error);
            throw error;
        }

        return totalInserted;
    }

    /**
     * Get logs by time range
     */
    async getLogsByTimeRange(projectId, environment, startTime, endTime, limit = null) {
        const db = await this.getDatabase(projectId, environment);
        
        let sql = `
            SELECT * FROM access_logs 
            WHERE project_id = ? AND environment = ? 
            AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp DESC
        `;
        
        const params = [projectId, environment, startTime, endTime];
        
        if (limit) {
            sql += ' LIMIT ?';
            params.push(limit);
        }

        console.log(`[SQLITE DEBUG] Querying logs from ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);
        
        const logs = await this.runQuery(db, sql, params);
        console.log(`[SQLITE DEBUG] Found ${logs.length} logs in time range`);
        
        return logs;
    }

    /**
     * Get top IPs with request counts
     */
    async getTopIps(projectId, environment, limit = 20, startTime = null, endTime = null) {
        const db = await this.getDatabase(projectId, environment);
        
        // Force a checkpoint to ensure we see the latest data
        await this.runQuery(db, 'PRAGMA wal_checkpoint(FULL)');
        
        let sql = `
            SELECT 
                ip,
                COUNT(*) as total_hits,
                COUNT(DISTINCT status_code) as unique_status_codes,
                COUNT(DISTINCT method) as unique_methods,
                MIN(timestamp) as first_seen,
                MAX(timestamp) as last_seen
            FROM access_logs 
            WHERE project_id = ? AND environment = ?
        `;
        
        const params = [projectId, environment];
        
        if (startTime && endTime) {
            sql += ' AND timestamp >= ? AND timestamp <= ?';
            params.push(startTime, endTime);
        }
        
        sql += `
            GROUP BY ip 
            ORDER BY total_hits DESC 
            LIMIT ?
        `;
        
        params.push(limit);

        console.log(`[SQLITE DEBUG] Getting top ${limit} IPs`);
        
        const topIps = await this.runQuery(db, sql, params);
        console.log(`[SQLITE DEBUG] Found ${topIps.length} top IPs`);
        
        // Get status code breakdown for each IP
        for (const ip of topIps) {
            ip.statusCodeBreakdown = await this.getIpStatusCodes(projectId, environment, ip.ip, startTime, endTime);
        }
        
        return topIps;
    }
    
    /**
     * Get status code breakdown for a specific IP
     */
    async getIpStatusCodes(projectId, environment, ip, startTime = null, endTime = null) {
        const db = await this.getDatabase(projectId, environment);
        
        let sql = `
            SELECT status_code, COUNT(*) as count
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ?
        `;
        
        const params = [projectId, environment, ip];
        
        if (startTime && endTime) {
            sql += ' AND timestamp >= ? AND timestamp <= ?';
            params.push(startTime, endTime);
        }
        
        sql += ' GROUP BY status_code ORDER BY count DESC';
        
        const breakdown = await this.runQuery(db, sql, params);
        
        // Convert to object format {200: 1500, 404: 50}
        const result = {};
        breakdown.forEach(row => {
            result[row.status_code] = row.count;
        });
        
        return result;
    }

    /**
     * Get detailed data for a specific IP
     */
    async getIpDetails(projectId, environment, ip, startTime = null, endTime = null) {
        const db = await this.getDatabase(projectId, environment);
        
        let timeCondition = '';
        const params = [projectId, environment, ip];
        
        if (startTime && endTime) {
            timeCondition = ' AND timestamp >= ? AND timestamp <= ?';
            params.push(startTime, endTime);
        }
        
        // Get status code breakdown
        const statusCodeSql = `
            SELECT status_code, COUNT(*) as count
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ?${timeCondition}
            GROUP BY status_code
            ORDER BY count DESC
        `;
        
        // Get method breakdown  
        const methodSql = `
            SELECT method, COUNT(*) as count
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ?${timeCondition}
            GROUP BY method
            ORDER BY count DESC
        `;
        
        // Get top URLs with detailed info (status codes, methods, user agents, timestamps)
        const urlSql = `
            SELECT 
                url,
                COUNT(*) as count,
                GROUP_CONCAT(DISTINCT status_code) as status_codes,
                GROUP_CONCAT(DISTINCT method) as methods,
                GROUP_CONCAT(DISTINCT CASE WHEN user_agent IS NOT NULL AND user_agent != '' THEN user_agent END) as user_agents,
                MAX(timestamp) as latest_timestamp,
                MIN(timestamp) as first_timestamp
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ?${timeCondition}
            GROUP BY url
            ORDER BY count DESC
            LIMIT 20
        `;
        
        // Get top User Agents
        const userAgentSql = `
            SELECT user_agent, COUNT(*) as count
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ? AND user_agent IS NOT NULL AND user_agent != ''${timeCondition}
            GROUP BY user_agent
            ORDER BY count DESC
            LIMIT 10
        `;

        console.log(`[SQLITE DEBUG] Getting details for IP: ${ip}`);
        
        const [statusCodes, methods, topUrls, userAgents] = await Promise.all([
            this.runQuery(db, statusCodeSql, params),
            this.runQuery(db, methodSql, params),
            this.runQuery(db, urlSql, params),
            this.runQuery(db, userAgentSql, params)
        ]);
        
        // Convert arrays to objects expected by frontend
        const statusCodesObj = {};
        statusCodes.forEach(row => {
            statusCodesObj[row.status_code] = row.count;
        });
        
        const methodsObj = {};
        methods.forEach(row => {
            methodsObj[row.method] = row.count;
        });
        
        const topUrlsArray = topUrls.map(row => ({
            url: row.url,
            count: row.count,
            statusCodes: row.status_codes ? row.status_codes.split(',') : [],
            methods: row.methods ? row.methods.split(',') : [],
            userAgents: row.user_agents ? row.user_agents.split(',') : [],
            latestTimestamp: row.latest_timestamp,
            firstTimestamp: row.first_timestamp
        }));
        
        const userAgentsArray = userAgents.map(row => ({
            userAgent: row.user_agent,
            count: row.count
        }));
        
        console.log(`[SQLITE DEBUG] Found ${statusCodes.length} status codes, ${methods.length} methods, ${topUrls.length} top URLs, ${userAgents.length} user agents for IP ${ip}`);
        
        return {
            statusCodes: statusCodesObj,
            methods: methodsObj,
            topUrls: topUrlsArray,
            userAgents: userAgentsArray
        };
    }

    /**
     * Get paginated URLs for a specific IP
     */
    async getIpUrls(projectId, environment, ip, startTime = null, endTime = null, limit = 10, offset = 0) {
        const db = await this.getDatabase(projectId, environment);
        
        let timeCondition = '';
        const params = [projectId, environment, ip];
        
        if (startTime && endTime) {
            timeCondition = ' AND timestamp >= ? AND timestamp <= ?';
            params.push(startTime, endTime);
        }
        
        // Get total count
        const countSql = `
            SELECT COUNT(DISTINCT url) as total
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ?${timeCondition}
        `;
        
        // Get paginated URLs with detailed info
        const urlsSql = `
            SELECT 
                url,
                COUNT(*) as count,
                GROUP_CONCAT(DISTINCT status_code) as status_codes,
                GROUP_CONCAT(DISTINCT method) as methods,
                GROUP_CONCAT(DISTINCT CASE WHEN user_agent IS NOT NULL AND user_agent != '' THEN user_agent END) as user_agents,
                MAX(timestamp) as latest_timestamp,
                MIN(timestamp) as first_timestamp
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ?${timeCondition}
            GROUP BY url
            ORDER BY count DESC
            LIMIT ? OFFSET ?
        `;

        console.log(`[SQLITE DEBUG] Getting paginated URLs for IP: ${ip}, limit: ${limit}, offset: ${offset}`);
        
        const [totalResult, urls] = await Promise.all([
            this.runQuerySingle(db, countSql, params),
            this.runQuery(db, urlsSql, [...params, limit, offset])
        ]);
        
        const total = totalResult?.total || 0;
        const hasMore = (offset + limit) < total;
        
        const urlsArray = urls.map(row => ({
            url: row.url,
            count: row.count,
            statusCodes: row.status_codes ? row.status_codes.split(',') : [],
            methods: row.methods ? row.methods.split(',') : [],
            userAgents: row.user_agents ? row.user_agents.split(',') : [],
            latestTimestamp: row.latest_timestamp,
            firstTimestamp: row.first_timestamp
        }));
        
        console.log(`[SQLITE DEBUG] Found ${urls.length} URLs (${total} total, hasMore: ${hasMore}) for IP ${ip}`);
        
        return {
            urls: urlsArray,
            total,
            hasMore
        };
    }

    /**
     * Get UserAgent data for a specific IP
     */
    async getIpUserAgents(projectId, environment, ip, startTime = null, endTime = null) {
        const db = await this.getDatabase(projectId, environment);
        
        let sql = `
            SELECT 
                user_agent,
                COUNT(*) as count
            FROM access_logs 
            WHERE project_id = ? AND environment = ? AND ip = ?
            AND user_agent IS NOT NULL AND user_agent != ''
        `;
        
        const params = [projectId, environment, ip];
        
        if (startTime && endTime) {
            sql += ' AND timestamp >= ? AND timestamp <= ?';
            params.push(startTime, endTime);
        }
        
        sql += `
            GROUP BY user_agent 
            ORDER BY count DESC
        `;

        console.log(`[SQLITE DEBUG] Getting UserAgent data for IP: ${ip}`);
        
        const userAgents = await this.runQuery(db, sql, params);
        console.log(`[SQLITE DEBUG] Found ${userAgents.length} unique UserAgents for IP ${ip}`);
        
        return userAgents;
    }

    /**
     * Get time series data for charting
     */
    async getTimeSeriesData(projectId, environment, ips, startTime, endTime, bucketSizeMinutes = 5) {
        const db = await this.getDatabase(projectId, environment);
        
        const bucketSizeSeconds = bucketSizeMinutes * 60;
        const buckets = [];
        
        // Generate time buckets
        for (let time = startTime; time <= endTime; time += bucketSizeSeconds) {
            buckets.push({
                timestamp: time,
                bucket_start: time,
                bucket_end: time + bucketSizeSeconds
            });
        }

        console.log(`[SQLITE DEBUG] Generating time series data for ${ips.length} IPs in ${buckets.length} buckets`);

        const timeSeriesData = [];
        
        for (const bucket of buckets) {
            const bucketData = {
                timestamp: bucket.timestamp,
                totalRequests: 0,
                ipCounts: {}
            };

            // Get data for each IP in this time bucket
            for (const ip of ips) {
                const sql = `
                    SELECT COUNT(*) as count
                    FROM access_logs 
                    WHERE project_id = ? AND environment = ? 
                    AND ip = ? 
                    AND timestamp >= ? AND timestamp < ?
                `;
                
                const params = [projectId, environment, ip, bucket.bucket_start, bucket.bucket_end];
                
                const result = await this.runQuerySingle(db, sql, params);
                const count = result ? result.count : 0;
                
                bucketData.ipCounts[ip] = count;
                bucketData.totalRequests += count;
            }

            timeSeriesData.push(bucketData);
        }

        console.log(`[SQLITE DEBUG] Generated time series data with ${timeSeriesData.length} buckets`);
        return timeSeriesData;
    }

    /**
     * Get database statistics
     */
    async getDatabaseStats(projectId, environment) {
        const db = await this.getDatabase(projectId, environment);
        
        // Force a checkpoint to ensure we see the latest data
        await this.runQuery(db, 'PRAGMA wal_checkpoint(FULL)');
        
        const stats = await this.runQuerySingle(db, `
            SELECT 
                COUNT(*) as total_logs,
                COUNT(DISTINCT ip) as unique_ips,
                MIN(timestamp) as earliest_timestamp,
                MAX(timestamp) as latest_timestamp,
                COUNT(DISTINCT status_code) as unique_status_codes,
                COUNT(DISTINCT method) as unique_methods
            FROM access_logs 
            WHERE project_id = ? AND environment = ?
        `, [projectId, environment]);

        // Get database file size
        const dbKey = `${projectId}-${environment}`;
        const dbPath = `/tmp/access_logs-${dbKey}.db`;
        
        try {
            const stats_fs = await fs.stat(dbPath);
            stats.database_size_bytes = stats_fs.size;
            stats.database_size_mb = (stats_fs.size / (1024 * 1024)).toFixed(2);
        } catch (error) {
            stats.database_size_bytes = 0;
            stats.database_size_mb = '0.00';
        }

        return stats;
    }

    /**
     * Clean up old data
     */
    async cleanupOldData(projectId, environment, maxAgeDays = 30) {
        const db = await this.getDatabase(projectId, environment);
        const cutoffTime = Math.floor(Date.now() / 1000) - (maxAgeDays * 24 * 60 * 60);
        
        console.log(`[SQLITE DEBUG] Cleaning up data older than ${maxAgeDays} days (before ${new Date(cutoffTime * 1000).toISOString()})`);
        
        const deleted = await this.runQueryAffected(db, `
            DELETE FROM access_logs 
            WHERE project_id = ? AND environment = ? AND timestamp < ?
        `, [projectId, environment, cutoffTime]);
        
        console.log(`[SQLITE DEBUG] Deleted ${deleted} old log entries`);
        return deleted;
    }

    /**
     * Vacuum database to reclaim space
     */
    async vacuumDatabase(projectId, environment) {
        const db = await this.getDatabase(projectId, environment);
        
        console.log('[SQLITE DEBUG] Running VACUUM to optimize database size');
        
        await this.runQuery(db, 'VACUUM');
        
        console.log('[SQLITE DEBUG] VACUUM completed');
    }

    /**
     * Close database connection
     */
    async closeDatabase(projectId, environment) {
        const dbKey = `${projectId}-${environment}`;
        const db = this.databases.get(dbKey);
        
        if (db) {
            console.log(`[SQLITE DEBUG] Closing database connection for ${dbKey}`);
            db.close();
            this.databases.delete(dbKey);
        }
    }

    /**
     * Close all database connections
     */
    async closeAllDatabases() {
        console.log('[SQLITE DEBUG] Closing all database connections');
        
        for (const [key, db] of this.databases) {
            db.close();
        }
        
        this.databases.clear();
    }
}

// Export singleton instance
export const sqliteService = new SQLiteService(); 