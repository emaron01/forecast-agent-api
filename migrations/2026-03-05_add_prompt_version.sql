ALTER TABLE opportunities
ADD COLUMN IF NOT EXISTS prompt_version text;

COMMENT ON COLUMN opportunities.prompt_version IS
'SHA256 hash (first 12 chars) of the composed prompt used
 for the most recent scoring pass. Enables audit of score
 changes across prompt versions.';
