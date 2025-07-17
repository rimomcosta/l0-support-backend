import { logger } from '../../logger.js';
import { aiService } from '../aiService.js';

class TransactionAnalysisAgent {
    constructor() {
        this.logger = logger;
        this.provider = 'google_vertex';
        this.model = 'gemini-2.5-flash';
        this.maxTokens = 32000;
        this.temperature = 0.1;
        this.stream = false;
    }

    async analyzeTransaction(yamlContent, analysisName, projectId, environment) {
        const startTime = Date.now();
        
        try {
            this.logger.info(`[AI AGENT] Starting analysis for "${analysisName}" in ${projectId}/${environment}`);
            
            // Build the prompt
            this.logger.info(`[AI AGENT] Building analysis prompt for "${analysisName}"`);
            const promptStartTime = Date.now();
            const prompt = this.buildAnalysisPrompt(yamlContent, analysisName, projectId, environment);
            const promptTime = Date.now() - promptStartTime;
            this.logger.info(`[AI AGENT] Prompt built in ${promptTime}ms for "${analysisName}"`);

            // Estimate token count
            const estimatedTokens = Math.ceil(prompt.length / 4); // Rough estimation
            this.logger.info(`[AI AGENT] Estimated tokens for "${analysisName}": ${estimatedTokens}`);

            // Get AI adapter
            this.logger.info(`[AI AGENT] Getting AI adapter for "${analysisName}"`);
            const adapterStartTime = Date.now();
            const adapter = aiService.getAdapter(this.provider, {
                model: this.model,
                maxTokens: this.maxTokens,
                temperature: this.temperature,
                stream: this.stream
            });
            const adapterTime = Date.now() - adapterStartTime;
            this.logger.info(`[AI AGENT] Adapter ready in ${adapterTime}ms for "${analysisName}"`);

            // Call the AI service
            this.logger.info(`[AI AGENT] Calling AI service for "${analysisName}"`);
            const aiCallStartTime = Date.now();
            const response = await adapter.generateCode({
                prompt: prompt,
                model: this.model,
                temperature: this.temperature,
                maxTokens: this.maxTokens
            });
            const aiCallTime = Date.now() - aiCallStartTime;
            this.logger.info(`[AI AGENT] AI service responded in ${aiCallTime}ms for "${analysisName}"`);

            const totalProcessingTime = Date.now() - startTime;
            this.logger.info(`[AI AGENT] Analysis completed successfully for "${analysisName}" in ${totalProcessingTime}ms total`);
            
            return {
                success: true,
                analysis: response,
                processingTimeMs: totalProcessingTime,
                tokenCount: this.estimateTokenCount(response)
            };
            
        } catch (error) {
            const totalProcessingTime = Date.now() - startTime;
            this.logger.error(`[AI AGENT] Analysis failed for "${analysisName}" after ${totalProcessingTime}ms:`, error);
            
            return {
                success: false,
                error: error.message,
                processingTimeMs: totalProcessingTime
            };
        }
    }

    buildAnalysisPrompt(yamlContent, analysisName, projectId, environment) {
        return `You are an expert performance analyst specializing in New Relic transaction traces. You have been given a transaction trace in YAML format that represents the execution flow of a web request.

PROJECT CONTEXT:
- Project ID: ${projectId}
- Environment: ${environment}
- Analysis Name: ${analysisName}

YAML TRANSACTION TRACE:
\`\`\`yaml
${yamlContent}
\`\`\`

TASK:
Perform a comprehensive analysis of this transaction trace and provide detailed insights in the following structured format:

## EXECUTIVE SUMMARY
- Overall transaction performance assessment
- Key performance indicators (total duration, bottlenecks, etc.)
- Critical issues identified

## PERFORMANCE ANALYSIS
- **Response Time Breakdown**: Analyze the total response time and identify where time is spent
- **Bottleneck Identification**: Identify the slowest operations and their impact
- **Database Performance**: Analyze SQL queries, connection times, and query optimization opportunities
- **External Service Calls**: Identify external API calls and their performance impact
- **Memory Usage**: Analyze memory consumption patterns if available

## CODE-LEVEL INSIGHTS
- **Function Performance**: Identify slow functions and optimization opportunities
- **File-Level Analysis**: Highlight problematic files and line numbers
- **Call Stack Analysis**: Understand the execution flow and identify optimization paths

## RECOMMENDATIONS
- **Immediate Actions**: Quick wins that can be implemented right away
- **Short-term Optimizations**: Changes that can be made in the next sprint
- **Long-term Improvements**: Architectural changes for better performance
- **Monitoring Suggestions**: What metrics to track going forward

## RISK ASSESSMENT
- **Critical Issues**: Problems that could cause outages or severe performance degradation
- **Performance Debt**: Technical debt related to performance
- **Scalability Concerns**: Issues that could impact system scaling

## TECHNICAL DETAILS
- **Trace Structure**: Analysis of the trace tree structure
- **Error Patterns**: Any error patterns or exceptions identified
- **Resource Utilization**: CPU, memory, and I/O patterns

Please provide a detailed, actionable analysis that would be valuable for both developers and operations teams. Focus on practical recommendations that can improve the system's performance and reliability.

Format your response in clear, well-structured sections with bullet points and specific recommendations.`;
    }

    estimateTokenCount(text) {
        // Rough estimation: 1 token ≈ 4 characters for English text
        return Math.ceil(text.length / 4);
    }
}

export default new TransactionAnalysisAgent(); 