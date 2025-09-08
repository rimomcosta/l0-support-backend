import { HealthManagementService } from '../../services/healthManagementService.js';

export function checkHealth(req, res) {
    const healthService = new HealthManagementService();
    const result = healthService.checkHealth(req);
    
    res.status(result.statusCode).json(result.data);
}