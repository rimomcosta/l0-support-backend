-- Add missing columns to chat_sessions table
-- This migration adds title, project_id, and environment columns

ALTER TABLE chat_sessions 
ADD COLUMN title VARCHAR(255) DEFAULT 'Untitled Chat',
ADD COLUMN project_id VARCHAR(255) DEFAULT NULL,
ADD COLUMN environment VARCHAR(255) DEFAULT NULL;

-- Add indexes for better performance
CREATE INDEX idx_chat_sessions_project_id ON chat_sessions(project_id);
CREATE INDEX idx_chat_sessions_environment ON chat_sessions(environment);
CREATE INDEX idx_chat_sessions_title ON chat_sessions(title);
