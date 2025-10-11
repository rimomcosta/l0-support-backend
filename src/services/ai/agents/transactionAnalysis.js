import { logger } from '../../logger.js';
import { aiService } from '../aiService.js';
import { TokenQuotaService } from '../../tokenQuotaService.js';
import fs from 'fs/promises';

// Load and combine instruction markdown files
const loadInstructions = async () => {
    try {
        const baseInstruction = await fs.readFile('./src/services/ai/agents/chat/instructions/base_instruction.md', 'utf-8');
        const knowledgeBase = await fs.readFile('./src/services/ai/agents/chat/instructions/knowledge_base.md', 'utf-8');
        const notebook = await fs.readFile('./src/services/ai/agents/chat/instructions/notebook.md', 'utf-8');

        // Combine according to specified format (plain text, no parsing)
        const combinedInstructions = `${baseInstruction}

---

This is your knowledge base:

${knowledgeBase}

---

These are some examples and extra information you should be aware of:

${notebook}

---

All the user's requests should take these information into account.`;

        return combinedInstructions;
    } catch (err) {
        logger.error('Failed to load instruction files:', err);
        throw new Error(`Failed to load instruction files: ${err.message}`);
    }
};

class TransactionAnalysisAgent {
    constructor() {
        this.logger = logger;
        this.provider = 'google_vertex';
        this.model = 'gemini-2.5-pro';
        this.maxTokens = 32000;
        this.temperature = 0.7;
        this.stream = false;
    }

    async analyzeTransaction(yamlContent, analysisName, projectId, environment, extraContext = '', userId = null) {
        const startTime = Date.now();
        
        try {
            this.logger.info(`[AI AGENT] Starting analysis for "${analysisName}" in ${projectId}/${environment}`);
            
            // Build the prompt
            this.logger.info(`[AI AGENT] Building analysis prompt for "${analysisName}"`);
            const promptStartTime = Date.now();
            const prompt = this.buildAnalysisPrompt(yamlContent, analysisName, projectId, environment, extraContext);
            const promptTime = Date.now() - promptStartTime;
            this.logger.info(`[AI AGENT] Prompt built in ${promptTime}ms for "${analysisName}"`);

            const instructions = await loadInstructions();
            const systemMessage = instructions + '\n\nPlease analyse the Magento 2 transaction below extracted from New Relic on Adobe Commerce Cloud. Read the entire file, add it to your context and perform an analysis. Remember that this is one of many other transactions.';
            const fullInput = systemMessage + '\n\n' + prompt;

            // Check token quota if userId is provided
            if (userId) {
                try {
                    const quotaCheckResult = await TokenQuotaService.checkAndEnforceQuota(
                        userId,
                        fullInput,
                        this.model
                    );

                    if (!quotaCheckResult.allowed) {
                        this.logger.warn(`Token quota exceeded for user ${userId} in transaction analysis`, {
                            analysisName,
                            quotaInfo: quotaCheckResult.quotaInfo
                        });

                        const quotaError = TokenQuotaService.createQuotaExceededError(quotaCheckResult.quotaInfo);
                        
                        return {
                            success: false,
                            error: quotaError.error,
                            quotaExceeded: true,
                            quotaInfo: quotaError.details,
                            processingTimeMs: Date.now() - startTime
                        };
                    }

                    this.logger.info(`Token quota check passed for user ${userId} in transaction analysis`, {
                        analysisName,
                        estimatedInputTokens: quotaCheckResult.estimatedInputTokens,
                        remaining: quotaCheckResult.quotaInfo.remaining
                    });
                } catch (err) {
                    this.logger.error(`Failed to check token quota for transaction analysis:`, err);
                    // Continue anyway - don't block on quota check errors
                }
            }

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
                systemMessage: systemMessage,
                temperature: this.temperature,
                maxTokens: this.maxTokens
            });

            const aiCallTime = Date.now() - aiCallStartTime;
            this.logger.info(`[AI AGENT] AI service responded in ${aiCallTime}ms for "${analysisName}"`);

            // Track token usage if userId is provided
            if (userId) {
                try {
                    const inputTokens = await TokenQuotaService.countInputTokens(fullInput, this.model);
                    await TokenQuotaService.trackAfterGeneration(
                        userId,
                        inputTokens,
                        response,
                        this.model
                    );
                    this.logger.info(`Token usage tracked for user ${userId} in transaction analysis`);
                } catch (err) {
                    this.logger.error(`Failed to track token usage for transaction analysis:`, err);
                    // Don't fail the request if tracking fails
                }
            }

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

    buildAnalysisPrompt(yamlContent, analysisName, projectId, environment, extraContext = '') {
        return `- Project ID: ${projectId} - Environment: ${environment} - Analysis Name: ${analysisName} TRANSACTION TRACE:
\`\`\`yaml
${yamlContent}
\`\`\`

${extraContext}

TASK:
Perform a comprehensive analysis of this transaction trace and provide detailed insights without necessary mention the exact segments, as nobody else will have access to this payload, in the following structured format:

HIGH-LEVEL SUMMARY:

PERFORMANCE ANALYSIS:
(Focus on what is causing the slowness and affecting the performance)

BEHAVIOURAL ANALYSIS:
(Focus on the overall behaviour, as slowness could be temporary due to other transactions or other factors)

ISSUES IDENTIFIED:
(Populate this section only if any issues are identified. Check for N+1 query patterns, DB/cache hit amplification, deep nesting, deep recursion and loops, and other issues)

THIRD-PARTY MODULES IDENTIFIED:
(Just bullet points and only if any are present. Ignore Fastly, Paypal, Braintree and Colinmollenhour as they are part of Magento)

DETAILED EXPLANATION:
(Provide as much details as possible as this section will be shared with another AI to cross-check your findings with the server data. This other AI won't have access to the original payload but it will have access to the code implementation so go really deep in this section.)

SUGGESTED ANSWER TO THE MERCHANT'S DEVELOPERS:
(Here you need to act as an Adobe Support Engineer. We don't provide support on third-party modules or customisations, but we can provide some explanation to help guide the merchant's developers. Generate an answer without using any bullet points. Make sure to explain and show the evidence for any issues you may have found. The merchant's developers may try to defend their code, so provide strong evidences. You can finish the explanation with something similar to: "I recommend your development team use a profiling tool such as Mage Profiler (https://experienceleague.adobe.com/en/docs/commerce-operations/configuration-guide/setup/mage-profiler) or Blackfire (https://developer.adobe.com/commerce/cloud-tools/docker/test/blackfire/) to better understand this transaction's performance, looking for bottlenecks and areas for improvement. Leveraging the use of collections can help reduce the number of calls to the DB, and reducing nested caching operations may lower the number of hits to Redis.")`;
    }

    estimateTokenCount(text) {
        // Rough estimation: 1 token ≈ 4 characters for English text
        return Math.ceil(text.length / 4);
    }
}

export default new TransactionAnalysisAgent(); 