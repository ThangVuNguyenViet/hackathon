CREATE TABLE IF NOT EXISTS pending_customer_turns (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  steer_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  claimed_run_id TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_customer_turns_session_external_message_idx
  ON pending_customer_turns (session_id, external_message_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  coalesced_input_text TEXT NOT NULL,
  superseded_by_run_id TEXT,
  irreversible_side_effect_at TEXT,
  irreversible_tool_name TEXT,
  assistant_turn_id TEXT,
  delivery_status TEXT NOT NULL,
  delivery_external_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_runs_session_generation_idx
  ON agent_runs (session_id, generation, id);

CREATE TABLE IF NOT EXISTS agent_run_turns (
  run_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  PRIMARY KEY (run_id, turn_id)
);

CREATE TABLE IF NOT EXISTS session_agent_state (
  session_id TEXT PRIMARY KEY,
  current_run_id TEXT,
  generation INTEGER NOT NULL,
  debounce_deadline_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS session_agent_state_due_idx
  ON session_agent_state (debounce_deadline_at, session_id)
  WHERE current_run_id IS NULL AND debounce_deadline_at IS NOT NULL;
