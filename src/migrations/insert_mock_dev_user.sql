-- Insert mock development user for USE_OKTA=false mode
-- This user is used when USE_OKTA=false to bypass authentication in development
-- 
-- NOTE: This migration is kept for manual database setup, but the application
-- now uses the centralized mock user configuration from src/config/mockUser.js
-- which is automatically inserted during app startup when USE_OKTA=false

INSERT IGNORE INTO users (
    user_id,
    username,
    email,
    api_token,
    salt
) VALUES (
    'dev-admin-user',
    'Development Admin',
    'dev-admin@example.com',
    NULL,
    'dev-salt-placeholder'
); 