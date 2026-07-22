ALTER TABLE agent_runs
  ADD COLUMN execution_attempt INTEGER NOT NULL DEFAULT 0
  CHECK (execution_attempt >= 0);

ALTER TABLE agent_runs
  ADD COLUMN execution_lease_token TEXT;

ALTER TABLE agent_runs
  ADD COLUMN execution_lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS agent_runs_execution_lease_recovery_idx
  ON agent_runs (status, execution_lease_expires_at);
