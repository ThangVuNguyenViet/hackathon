CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcript_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  external_message_id TEXT,
  external_user_id TEXT,
  delivery_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS session_controls (
  session_id TEXT PRIMARY KEY,
  agent_mode TEXT NOT NULL,
  assigned_agent_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_streaming_assignments (
  session_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  path TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_revision TEXT NOT NULL,
  schema_version INTEGER,
  provisional_genui_enabled BOOLEAN NOT NULL,
  run_id TEXT,
  assigned_at TIMESTAMPTZ NOT NULL,
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
  provisional_genui_enabled BOOLEAN NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
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
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS customer_run_events_replay_idx
  ON customer_run_events (run_id, sequence);
