CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_session_generation_claim_idx
  ON agent_runs (session_id, generation);
