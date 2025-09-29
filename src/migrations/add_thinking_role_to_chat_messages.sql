-- Add 'thinking' role to chat_messages table ENUM
-- This allows the system to save AI thinking process messages
ALTER TABLE chat_messages 
MODIFY COLUMN role ENUM('user','assistant','system','thinking') NOT NULL;



