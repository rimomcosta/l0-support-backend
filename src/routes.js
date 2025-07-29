// src/routes.js
import coreRoutes from './routes/coreRoutes.js';
import appRoutes from './routes/appRoutes.js';
import transactionAnalysisRoutes from './routes/transactionAnalysisRoutes.js';
import ipReportRoutes from './routes/ipReportRoutes.js';
import adminAnalyticsRoutes from './routes/adminAnalyticsRoutes.js';
import activityTrackingRoutes from './routes/analyticsRoutes.js';

export default function routes(app) {
    app.use('/api/v1', coreRoutes);
    app.use('/api/v1', appRoutes);
    app.use('/api/v1/transaction-analysis', transactionAnalysisRoutes);
    app.use('/api/v1/ip-report', ipReportRoutes);
    app.use('/api/v1/admin/analytics', adminAnalyticsRoutes);
    app.use('/api/v1/analytics', activityTrackingRoutes);
}