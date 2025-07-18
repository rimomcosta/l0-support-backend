ALTER TABLE transaction_analysis 
ADD COLUMN use_ai BOOLEAN DEFAULT TRUE COMMENT 'Whether this analysis should be used in AI chat (1=selected/green sparkles, 0=unselected/red sparkles)';

-- Update existing records to be selected by default (completed analyses)
UPDATE transaction_analysis 
SET use_ai = TRUE 
WHERE status = 'completed';
