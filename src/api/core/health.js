import { HealthManagementService } from '../../services/healthManagementService.js';

export async function checkHealth(req, res) {
    try {
        const healthService = new HealthManagementService();
        const result = await healthService.checkHealth(req);
        
        res.status(result.statusCode).json(result.data);
    } catch (error) {
        // Even if health check fails catastrophically, return a response
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Health check failed',
            message: error.message
        });
    }
}