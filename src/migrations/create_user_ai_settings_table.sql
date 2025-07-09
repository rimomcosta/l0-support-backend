-- src/migrations/create_user_ai_settings_table.sql
-- Migration: Create user_ai_settings table
-- Date: 2024
-- Description: Store user-specific AI configuration settings

CREATE TABLE IF NOT EXISTS user_ai_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    ai_model ENUM('reasoning', 'fast') NOT NULL DEFAULT 'fast',
    response_style ENUM('objective', 'balanced', 'creative') NOT NULL DEFAULT 'balanced',
    response_length ENUM('short', 'default', 'long') NOT NULL DEFAULT 'default',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_settings (user_id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; 