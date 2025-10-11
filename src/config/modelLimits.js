// src/config/modelLimits.js
// Context window limits for different AI models
// Based on official documentation and safe operating margins

/**
 * Model context window limits
 * - max: Maximum context window size (total input tokens)
 * - safe: Safe limit to allow room for response (typically max - 50k)
 * 
 * References:
 * - Gemini models: https://ai.google.dev/gemini-api/docs/models/gemini
 * - Claude models: https://docs.anthropic.com/claude/docs/models-overview
 */

export const MODEL_LIMITS = {
  // Gemini 1.5 series - 1M token context
  'gemini-1.5-pro': {
    max: 1000000,
    safe: 950000,
    description: 'Gemini 1.5 Pro with 1M token context'
  },
  'gemini-1.5-flash': {
    max: 1000000,
    safe: 950000,
    description: 'Gemini 1.5 Flash with 1M token context'
  },
  'gemini-1.5-pro-latest': {
    max: 1000000,
    safe: 950000,
    description: 'Gemini 1.5 Pro Latest'
  },
  'gemini-1.5-flash-latest': {
    max: 1000000,
    safe: 950000,
    description: 'Gemini 1.5 Flash Latest'
  },

  // Gemini 2.0 series - 1M token context
  'gemini-2.0-flash': {
    max: 1000000,
    safe: 950000,
    description: 'Gemini 2.0 Flash Experimental'
  },
  'gemini-2.0-flash-exp': {
    max: 1000000,
    safe: 950000,
    description: 'Gemini 2.0 Flash Experimental'
  },

  // Gemini 2.5 series - 1M token context
  'gemini-2.5-pro': {
    max: 1000000,
    safe: 950000,
    description: 'Gemini 2.5 Pro with 1M token context'
  },

  // Claude 3 series via Vertex AI - 200k token context
  'claude-3-opus': {
    max: 200000,
    safe: 190000,
    description: 'Claude 3 Opus via Vertex AI'
  },
  'claude-3-sonnet': {
    max: 200000,
    safe: 190000,
    description: 'Claude 3 Sonnet via Vertex AI'
  },
  'claude-3-haiku': {
    max: 200000,
    safe: 190000,
    description: 'Claude 3 Haiku via Vertex AI'
  },
  'claude-3-5-sonnet': {
    max: 200000,
    safe: 190000,
    description: 'Claude 3.5 Sonnet via Vertex AI'
  },

  // Claude Sonnet 4 via Vertex AI
  'claude-sonnet-4': {
    max: 200000,
    safe: 190000,
    description: 'Claude Sonnet 4 via Vertex AI'
  },
  'claude-sonnet-4@20250514': {
    max: 200000,
    safe: 190000,
    description: 'Claude Sonnet 4 (dated version) via Vertex AI'
  },

  // Default fallback for unknown models
  'default': {
    max: 1000000,
    safe: 950000,
    description: 'Default limit for unknown models'
  }
};

/**
 * Get context limits for a specific model
 * @param {string} modelName - Name of the AI model
 * @returns {Object} { max, safe, description }
 */
export function getModelLimits(modelName) {
  if (!modelName) {
    return MODEL_LIMITS.default;
  }

  // Direct match
  if (MODEL_LIMITS[modelName]) {
    return MODEL_LIMITS[modelName];
  }

  // Fuzzy match for model names with versions or suffixes
  const normalizedName = modelName.toLowerCase();
  
  for (const [key, value] of Object.entries(MODEL_LIMITS)) {
    if (normalizedName.includes(key.toLowerCase()) || key.toLowerCase().includes(normalizedName)) {
      return value;
    }
  }

  // Fallback to default
  return MODEL_LIMITS.default;
}

/**
 * Get safe token limit for a model (recommended limit before truncation)
 * @param {string} modelName - Name of the AI model
 * @returns {number} Safe token limit
 */
export function getSafeLimit(modelName) {
  return getModelLimits(modelName).safe;
}

/**
 * Get maximum token limit for a model
 * @param {string} modelName - Name of the AI model
 * @returns {number} Maximum token limit
 */
export function getMaxLimit(modelName) {
  return getModelLimits(modelName).max;
}

/**
 * Check if a token count exceeds the safe limit for a model
 * @param {number} tokenCount - Number of tokens
 * @param {string} modelName - Name of the AI model
 * @returns {boolean} True if exceeds safe limit
 */
export function exceedsSafeLimit(tokenCount, modelName) {
  return tokenCount > getSafeLimit(modelName);
}

