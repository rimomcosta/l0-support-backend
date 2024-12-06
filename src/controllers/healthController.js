import { redisClient } from '../services/redisService.js';
import { oidcClient } from '../services/oidcService.js';

export function checkHealth(req, res) {
    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        redis: redisClient.isReady ? 'connected' : 'disconnected',
        oidc: !!oidcClient ? 'initialized' : 'not initialized'
    };
    res.json(healthData);
}