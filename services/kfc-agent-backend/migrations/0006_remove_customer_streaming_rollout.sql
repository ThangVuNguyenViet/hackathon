DROP TABLE IF EXISTS customer_streaming_assignments;

ALTER TABLE customer_runs DROP COLUMN rollout_policy_revision;
ALTER TABLE customer_runs DROP COLUMN client_app_version;
ALTER TABLE customer_runs DROP COLUMN provisional_genui_enabled;
