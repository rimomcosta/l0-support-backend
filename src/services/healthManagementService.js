// src/services/healthManagementService.js
import { redisClient } from './redisService.js';
import { oidcClient } from './oidcService.js';

export class HealthManagementService {
    constructor() {
        // No logger needed for health checks
    }

    /**
     * Check system health
     * @param {Object} req - Express request object
     * @returns {Object} - Health data
     */
    checkHealth(req) {
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            redis: redisClient.isReady ? 'connected' : 'disconnected',
            oidc: !!oidcClient ? 'initialized' : 'not initialized',
            websocket: req.app.locals.wss ? 'initialized' : 'not initialized'
        };
        
        return {
            success: true,
            data: healthData,
            statusCode: 200
        };
    }
}
