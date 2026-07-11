CREATE TABLE IF NOT EXISTS customer_streaming_assignments (
  session_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  path TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_revision TEXT NOT NULL,
  schema_version INTEGER,
  provisional_genui_enabled INTEGER NOT NULL,
  run_id TEXT,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (session_id, client_message_id)
);

CREATE TABLE IF NOT EXISTS customer_runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL,
  phase TEXT,
  next_event_sequence INTEGER NOT NULL,
  rollout_policy_revision TEXT NOT NULL,
  client_app_version TEXT NOT NULL,
  client_schema_version INTEGER NOT NULL,
  provisional_genui_enabled INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  started_at TEXT,
  terminal_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS customer_runs_session_generation_idx
  ON customer_runs (session_id, generation, id);

CREATE TABLE IF NOT EXISTS customer_run_events (
  event_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS customer_run_events_replay_idx
  ON customer_run_events (run_id, sequence);
