-- Alter chat_messages content column from TEXT to LONGTEXT to support large message inputs (up to 4GB)
ALTER TABLE chat_messages MODIFY COLUMN content LONGTEXT NOT NULL; 