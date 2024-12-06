import coreRoutes from './routes/coreRoutes.js';
import appRoutes from './routes/appRoutes.js';

export default function routes(app) {
    app.use('/api/v1', coreRoutes);
    app.use('/api/v1', appRoutes);
}