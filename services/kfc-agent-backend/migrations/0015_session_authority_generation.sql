CREATE TABLE IF NOT EXISTS session_controls (
  session_id TEXT PRIMARY KEY,
  agent_mode TEXT NOT NULL,
  assigned_agent_id TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE session_controls
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customer_runs
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agent_runs
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE irreversible_operations
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0;
