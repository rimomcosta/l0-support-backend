import coreRoutes from './routes/coreRoutes.js';
import appRoutes from './routes/appRoutes.js';

export default function routes(app) {
    app.use('/api', coreRoutes);
    app.use('/api', appRoutes);
}