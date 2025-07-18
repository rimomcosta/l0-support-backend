import { initDatabase } from './config/initDatabase.js';
import { logger } from './services/logger.js';
import transactionAnalysisDao from './services/dao/transactionAnalysisDao.js';
import { WebSocketService } from './services/webSocketService.js';

async function startServer() {
    try {
        await initDatabase();
        logger.info('Database initialized successfully');
        
        // Automated cleanup of stuck analyses on startup
        try {
            const stuckAnalyses = await transactionAnalysisDao.getStuckAnalyses();
            if (stuckAnalyses.length > 0) {
                logger.warn(`Found ${stuckAnalyses.length} stuck analyses from previous sessions. Marking as failed...`);
                for (const analysis of stuckAnalyses) {
                    await transactionAnalysisDao.updateAnalysisStatus(
                        analysis.id,
                        'failed',
                        null,
                        'Analysis timed out due to server restart.',
                        0
                    );
                }
                logger.info('Stuck analyses have been successfully marked as failed.');
            }
        } catch (cleanupError) {
            logger.error('Error during automated cleanup of stuck analyses:', cleanupError);
        }

        const server = app.listen(port, () => {
            logger.info(`Server listening on port ${port}`);
        });

        WebSocketService.initialize(server);
        app.set('wss', WebSocketService.wss);

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer(); 