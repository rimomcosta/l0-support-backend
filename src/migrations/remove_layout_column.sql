-- Migration: Remove layout column from commands table
-- Date: 2024
-- Description: Remove the layout column as we're moving to a flexible resizing system

ALTER TABLE commands DROP COLUMN IF EXISTS layout; 