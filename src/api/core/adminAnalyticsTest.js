// src/api/core/adminAnalyticsTest.js
import { logger } from '../../services/logger.js';

// Test route
export async function testRoute(req, res) {
    logger.info('=== TEST ROUTE HIT ===');
    res.json({ message: 'Test route working' });
}

// Test route with parameter
export async function testRouteWithParam(req, res) {
    logger.info('=== TEST PARAM ROUTE HIT ===', { param: req.params.param });
    res.json({ message: 'Test param route working', param: req.params.param });
}
