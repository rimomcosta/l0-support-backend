import { requireAuth } from './middleware/auth.js';
import * as auth from './controllers/authController.js';
import * as environment from './controllers/environmentController.js';
import * as health from './controllers/healthController.js';

export default function routes(app) {
    // Auth routes
    app.get('/api/auth/login', auth.login);
    app.get('/callback', auth.callback);
    app.get('/api/auth/user', auth.getUser);
    app.post('/api/auth/logout', auth.logout);

    // Health routes
    app.get('/api/health', health.checkHealth);

    // Environment routes
    app.get('/api/environments/:projectId', requireAuth, environment.getEnvironments);

}