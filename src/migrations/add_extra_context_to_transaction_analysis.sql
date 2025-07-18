-- Add extra_context field to transaction_analysis table
ALTER TABLE transaction_analysis 
ADD COLUMN extra_context TEXT DEFAULT NULL AFTER analysis_name; 