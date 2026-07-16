ALTER TABLE irreversible_operations ADD COLUMN lease_token TEXT;

UPDATE irreversible_operations
SET lease_token = 'legacy:' || request_id || ':' || attempt_count
WHERE lease_token IS NULL;
