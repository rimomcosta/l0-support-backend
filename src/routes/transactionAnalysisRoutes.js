import express from 'express';
import * as transactionAnalysisController from '../api/app/transactionAnalysis.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Analyze a single transaction
router.post('/analyze', requireAuth, transactionAnalysisController.validateYamlPayload, transactionAnalysisController.analyzeTransaction);

// Get analysis by ID
router.get('/analysis/:id', requireAuth, transactionAnalysisController.getAnalysisById);

// Get analyses by project
router.get('/analyses', requireAuth, transactionAnalysisController.getAnalysesByProject);

// Delete analysis
router.delete('/analysis/:id', requireAuth, transactionAnalysisController.deleteAnalysis);

// Search analyses
router.get('/search', requireAuth, transactionAnalysisController.searchAnalyses);

// Get recent analyses for a specific project
router.get('/recent', requireAuth, transactionAnalysisController.getRecentAnalyses);

// Update analysis use_ai status
router.put('/analysis/:id/use-ai', requireAuth, transactionAnalysisController.updateAnalysisUseAi);

export default router;