-- src/migrations/create_user_token_usage_table.sql
-- Migration: Create user_token_usage table
-- Date: 2025-10-11
-- Description: Track daily token usage per user for quota enforcement

CREATE TABLE IF NOT EXISTS user_token_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    usage_date DATE NOT NULL,
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    daily_limit BIGINT NOT NULL DEFAULT 1000000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user_date (user_id, usage_date),
    INDEX idx_user_date (user_id, usage_date),
    INDEX idx_usage_date (usage_date),
    
    CONSTRAINT fk_user_token_usage
        FOREIGN KEY (user_id) 
        REFERENCES users(user_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

