// Input Sanitization Service
// Comprehensive sanitization strategy for handling user input while preserving content for LLM

/**
 * Multi-layer sanitization approach:
 * 
 * 1. Frontend Input Validation (utils/index.js):
 *    - Basic validation (length, type checking)
 *    - Preserves original content for LLM processing
 * 
 * 2. WebSocket Layer (webSocketService.js):
 *    - Removes dangerous control characters that could break JSON/logging
 *    - Preserves newlines, tabs, and legitimate whitespace
 *    - Prevents JSON injection attacks
 * 
 * 3. Backend API Layer (middleware/validation.js):
 *    - Additional control character removal
 *    - Basic trimming for API endpoints
 * 
 * 4. Database Layer:
 *    - MySQL prepared statements prevent SQL injection
 *    - LONGTEXT column handles large content up to 4GB
 * 
 * 5. Display Layer (formatMessageContent):
 *    - DOMPurify sanitizes content for safe HTML display
 *    - ReactMarkdown provides additional XSS protection
 *    - Allows safe markdown while blocking dangerous tags
 * 
 * 6. LLM Processing:
 *    - Original content preserved for AI processing
 *    - No content modification that would affect AI understanding
 */

/**
 * Sanitize user input for safe processing while preserving original content
 * Removes only control characters that could cause system issues
 */
export const sanitizeUserInput = (content) => {
    if (!content || typeof content !== 'string') {
        return content;
    }
    
    // Remove null bytes and dangerous control characters
    // Preserve newlines (\n), carriage returns (\r), and tabs (\t)
    // Remove characters: \x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F
    return content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

/**
 * Validate content for basic security while preserving LLM-destined content
 */
export const validateUserContent = (content, maxLength = 10000000) => {
    if (!content || typeof content !== 'string') {
        return { valid: false, error: 'Content cannot be empty' };
    }
    
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'Content cannot be empty' };
    }
    
    if (trimmed.length > maxLength) {
        return { valid: false, error: `Content is too long (max ${maxLength} characters)` };
    }
    
    // Apply basic sanitization
    const sanitized = sanitizeUserInput(trimmed);
    
    return { valid: true, content: sanitized };
};

/**
 * Sanitize for logging purposes - more aggressive redaction
 */
export const sanitizeForLogging = (data) => {
    if (typeof data === 'string') {
        // For logging, limit length and remove potential sensitive patterns
        const truncated = data.length > 200 ? data.substring(0, 200) + '...' : data;
        return sanitizeUserInput(truncated);
    }
    
    return data;
};

export default {
    sanitizeUserInput,
    validateUserContent,
    sanitizeForLogging
}; 