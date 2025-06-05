-- Migration: Create dashboard_layouts table
-- Date: 2024
-- Description: Store user-specific dashboard layouts per project and environment

CREATE TABLE IF NOT EXISTS dashboard_layouts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    environment VARCHAR(50) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    layouts JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_layout (project_id, environment, user_id),
    INDEX idx_project_env (project_id, environment),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci; 