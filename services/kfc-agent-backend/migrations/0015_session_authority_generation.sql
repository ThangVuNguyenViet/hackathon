ALTER TABLE session_controls
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customer_runs
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agent_runs
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE irreversible_operations
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;
