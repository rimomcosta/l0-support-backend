-- L0 Support Database Seed File
-- This file contains the initial data needed to start the application
-- Contains: mock development user only (commands are preserved)

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

-- Insert mock development user (only if it doesn't exist)
INSERT IGNORE INTO `users` VALUES
('dev-admin-user','Development Admin','dev-admin@example.com',NULL,'dev-salt-placeholder','2024-12-11 19:41:45','2024-12-11 19:41:45');

COMMIT;
