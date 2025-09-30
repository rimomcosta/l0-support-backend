// src/services/healthManagementService.js
import { redisClient } from './redisService.js';
import { oidcClient } from './oidcService.js';
import { pool } from '../config/database.js';
import { opensearchClient } from '../config/opensearch.js';

export class HealthManagementService {
    constructor() {
        // No logger needed for health checks
    }

    /**
     * Check database connectivity
     * @returns {Object} - Database status
     */
    async checkDatabase() {
        try {
            const connection = await pool.getConnection();
            await connection.ping();
            connection.release();
            return {
                status: 'OK',
                connected: true,
                message: 'Database connection successful'
            };
        } catch (error) {
            return {
                status: 'ERROR',
                connected: false,
                message: error.message
            };
        }
    }

    /**
     * Check Redis connectivity
     * @returns {Object} - Redis status
     */
    async checkRedis() {
        try {
            if (!redisClient.isReady) {
                return {
                    status: 'ERROR',
                    connected: false,
                    message: 'Redis client not ready'
                };
            }
            
            // Try to ping Redis
            await redisClient.ping();
            
            return {
                status: 'OK',
                connected: true,
                message: 'Redis connection successful'
            };
        } catch (error) {
            return {
                status: 'ERROR',
                connected: false,
                message: error.message
            };
        }
    }

    /**
     * Check OpenSearch connectivity
     * @returns {Object} - OpenSearch status
     */
    async checkOpenSearch() {
        try {
            const health = await opensearchClient.cluster.health();
            
            return {
                status: health.body.status === 'green' || health.body.status === 'yellow' ? 'OK' : 'WARNING',
                connected: true,
                cluster_status: health.body.status,
                message: `OpenSearch cluster status: ${health.body.status}`
            };
        } catch (error) {
            return {
                status: 'ERROR',
                connected: false,
                message: error.message
            };
        }
    }

    /**
     * Check OIDC status
     * @returns {Object} - OIDC status
     */
    checkOIDC() {
        const isInitialized = !!oidcClient;
        const isEnabled = process.env.USE_OKTA !== 'false';
        
        return {
            status: isEnabled ? (isInitialized ? 'OK' : 'ERROR') : 'DISABLED',
            initialized: isInitialized,
            enabled: isEnabled,
            message: isEnabled 
                ? (isInitialized ? 'OIDC client initialized' : 'OIDC client not initialized')
                : 'OIDC authentication disabled'
        };
    }

    /**
     * Check WebSocket status
     * @param {Object} req - Express request object
     * @returns {Object} - WebSocket status
     */
    checkWebSocket(req) {
        const isInitialized = !!req.app.locals.wss;
        
        return {
            status: isInitialized ? 'OK' : 'ERROR',
            initialized: isInitialized,
            message: isInitialized 
                ? 'WebSocket server initialized' 
                : 'WebSocket server not initialized'
        };
    }

    /**
     * Check system health
     * @param {Object} req - Express request object
     * @returns {Object} - Health data
     */
    async checkHealth(req) {
        const checks = {
            database: await this.checkDatabase(),
            redis: await this.checkRedis(),
            opensearch: await this.checkOpenSearch(),
            oidc: this.checkOIDC(),
            websocket: this.checkWebSocket(req)
        };

        // Determine overall status
        const hasError = Object.values(checks).some(check => check.status === 'ERROR');
        const hasWarning = Object.values(checks).some(check => check.status === 'WARNING');
        
        let overallStatus = 'healthy';
        let statusCode = 200;
        
        if (hasError) {
            overallStatus = 'unhealthy';
            statusCode = 503; // Service Unavailable
        } else if (hasWarning) {
            overallStatus = 'degraded';
            statusCode = 200; // Still operational
        }

        const healthData = {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            services: checks,
            environment: process.env.NODE_ENV || 'development'
        };
        
        return {
            success: statusCode === 200,
            data: healthData,
            statusCode
        };
    }
}
