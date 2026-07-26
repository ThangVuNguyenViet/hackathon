CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_session_items (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  item_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_session_items_session_id_idx
  ON agent_session_items (session_id, id);

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
  session_authority_generation INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS non_agent_text_deliveries (
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'kfc-non-agent-text-delivery-v1'),
  request_key TEXT PRIMARY KEY CHECK (
    length(request_key) = 64
    AND request_key !~ '[^0-9a-f]'
  ),
  session_binding_digest TEXT NOT NULL CHECK (
    length(session_binding_digest) = 64
    AND session_binding_digest !~ '[^0-9a-f]'
  ),
  reserved_session_authority_generation INTEGER NOT NULL
    CHECK (reserved_session_authority_generation >= 0),
  channel TEXT NOT NULL CHECK (channel IN ('kfc', 'messenger', 'zalo')),
  assistant_turn_id TEXT NOT NULL,
  agent_binding_digest TEXT NOT NULL,
  recipient_binding_digest TEXT NOT NULL,
  presentation_binding_digest TEXT NOT NULL,
  delivery_binding_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'sending',
      'confirmed_sent',
      'confirmed_not_sent',
      'outcome_unknown'
    )
  ),
  delivery_attempt INTEGER NOT NULL
    CHECK (delivery_attempt BETWEEN 0 AND 3),
  delivery_attempt_token TEXT,
  sending_lease_expires_at TIMESTAMPTZ,
  provider_message_id TEXT,
  outcome_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (
      status = 'pending'
      AND delivery_attempt = 0
      AND delivery_attempt_token IS NULL
      AND sending_lease_expires_at IS NULL
      AND provider_message_id IS NULL
      AND outcome_code IS NULL
    )
    OR (
      status = 'sending'
      AND delivery_attempt BETWEEN 1 AND 3
      AND delivery_attempt_token IS NOT NULL
      AND sending_lease_expires_at IS NOT NULL
      AND provider_message_id IS NULL
      AND outcome_code IS NULL
    )
    OR (
      status = 'confirmed_sent'
      AND delivery_attempt BETWEEN 1 AND 3
      AND delivery_attempt_token IS NOT NULL
      AND sending_lease_expires_at IS NULL
      AND (channel = 'kfc' OR provider_message_id IS NOT NULL)
      AND outcome_code IS NULL
    )
    OR (
      status IN ('confirmed_not_sent', 'outcome_unknown')
      AND delivery_attempt BETWEEN 1 AND 3
      AND delivery_attempt_token IS NOT NULL
      AND sending_lease_expires_at IS NULL
      AND provider_message_id IS NULL
      AND outcome_code IS NOT NULL
    )
    OR (
      status = 'confirmed_not_sent'
      AND delivery_attempt = 0
      AND delivery_attempt_token IS NULL
      AND sending_lease_expires_at IS NULL
      AND provider_message_id IS NULL
      AND outcome_code = 'non_agent_delivery_abandoned_by_reset'
    )
  )
);

CREATE INDEX IF NOT EXISTS non_agent_text_deliveries_session_idx
  ON non_agent_text_deliveries (session_binding_digest, created_at);

CREATE INDEX IF NOT EXISTS non_agent_text_deliveries_recovery_idx
  ON non_agent_text_deliveries (status, sending_lease_expires_at);

CREATE TABLE IF NOT EXISTS non_agent_text_delivery_attempts (
  request_key TEXT NOT NULL
    REFERENCES non_agent_text_deliveries(request_key) ON DELETE CASCADE,
  delivery_attempt INTEGER NOT NULL
    CHECK (delivery_attempt BETWEEN 1 AND 3),
  delivery_attempt_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (request_key, delivery_attempt)
);

CREATE TABLE IF NOT EXISTS customer_runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  generation INTEGER NOT NULL,
  session_authority_generation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  phase TEXT,
  next_event_sequence INTEGER NOT NULL,
  client_schema_version INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  session_authority_generation INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  execution_attempt INTEGER NOT NULL DEFAULT 0 CHECK (
    execution_attempt >= 0
  ),
  execution_lease_token TEXT,
  execution_lease_expires_at TIMESTAMPTZ,
  CHECK (
    (
      execution_lease_token IS NULL
      AND execution_lease_expires_at IS NULL
    )
    OR (
      execution_lease_token IS NOT NULL
      AND execution_lease_expires_at IS NOT NULL
    )
  ),
  coalesced_input_text TEXT NOT NULL,
  superseded_by_run_id TEXT,
  irreversible_side_effect_at TIMESTAMPTZ,
  irreversible_tool_name TEXT,
  assistant_turn_id TEXT,
  delivery_status TEXT NOT NULL,
  delivery_external_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run_text_deliveries (
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'kfc-agent-run-text-delivery-v1'),
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE CHECK (
    length(run_id) BETWEEN 1 AND 512 AND run_id = btrim(run_id)
  ),
  run_execution_attempt INTEGER NOT NULL
    CHECK (run_execution_attempt BETWEEN 1 AND 3),
  run_execution_origin_attempt INTEGER NOT NULL CHECK (
    run_execution_origin_attempt BETWEEN 1 AND 3
    AND run_execution_origin_attempt <= run_execution_attempt
  ),
  run_execution_lease_token TEXT NOT NULL CHECK (
    length(run_execution_lease_token) BETWEEN 1 AND 512
    AND run_execution_lease_token = btrim(run_execution_lease_token)
  ),
  run_execution_lease_token_digest TEXT NOT NULL CHECK (
    run_execution_lease_token_digest ~ '^[0-9a-f]{64}$'
  ),
  prior_run_execution_lease_token_digests JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (
      jsonb_typeof(prior_run_execution_lease_token_digests) = 'array'
      AND jsonb_array_length(
        prior_run_execution_lease_token_digests
      ) = run_execution_attempt - run_execution_origin_attempt
    ),
  channel TEXT NOT NULL CHECK (channel IN ('messenger', 'zalo')),
  assistant_turn_id TEXT NOT NULL UNIQUE CHECK (
    length(assistant_turn_id) BETWEEN 1 AND 512
    AND assistant_turn_id = btrim(assistant_turn_id)
  )
    REFERENCES conversation_turns(id),
  recipient_binding_digest TEXT NOT NULL
    CHECK (recipient_binding_digest ~ '^[0-9a-f]{64}$'),
  presentation_binding_digest TEXT NOT NULL
    CHECK (presentation_binding_digest ~ '^[0-9a-f]{64}$'),
  delivery_binding_digest TEXT NOT NULL
    CHECK (delivery_binding_digest ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'sending', 'confirmed_not_sent',
    'confirmed_sent', 'delivery_outcome_unknown'
  )),
  delivery_attempt INTEGER NOT NULL CHECK (delivery_attempt BETWEEN 0 AND 3),
  last_delivery_run_execution_attempt INTEGER CHECK (
    last_delivery_run_execution_attempt IS NULL
    OR last_delivery_run_execution_attempt BETWEEN 1 AND 3
  ),
  delivery_attempt_token TEXT CHECK (
    delivery_attempt_token IS NULL OR (
      length(delivery_attempt_token) BETWEEN 1 AND 512
      AND delivery_attempt_token = btrim(delivery_attempt_token)
    )
  ),
  provider_message_id TEXT CHECK (
    provider_message_id IS NULL OR (
      length(provider_message_id) BETWEEN 1 AND 512
      AND provider_message_id = btrim(provider_message_id)
    )
  ),
  outcome_code TEXT CHECK (
    outcome_code IS NULL OR (
      length(outcome_code) BETWEEN 1 AND 256
      AND outcome_code = btrim(outcome_code)
    )
  ),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (status = 'pending' AND delivery_attempt = 0
      AND delivery_attempt_token IS NULL
      AND last_delivery_run_execution_attempt IS NULL
      AND provider_message_id IS NULL AND outcome_code IS NULL)
    OR (status = 'sending' AND delivery_attempt BETWEEN 1 AND 3
      AND delivery_attempt_token IS NOT NULL
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND last_delivery_run_execution_attempt = run_execution_attempt
      AND provider_message_id IS NULL AND outcome_code IS NULL)
    OR (status = 'confirmed_not_sent' AND delivery_attempt BETWEEN 1 AND 3
      AND delivery_attempt_token IS NOT NULL
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND run_execution_attempt BETWEEN
        last_delivery_run_execution_attempt
        AND last_delivery_run_execution_attempt + 1
      AND provider_message_id IS NULL AND outcome_code IS NOT NULL)
    OR (status = 'confirmed_sent' AND delivery_attempt BETWEEN 1 AND 3
      AND delivery_attempt_token IS NOT NULL
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND last_delivery_run_execution_attempt = run_execution_attempt
      AND provider_message_id IS NOT NULL AND outcome_code IS NULL)
    OR (status = 'delivery_outcome_unknown'
      AND delivery_attempt BETWEEN 1 AND 3
      AND delivery_attempt_token IS NOT NULL
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND last_delivery_run_execution_attempt = run_execution_attempt
      AND provider_message_id IS NULL AND outcome_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS agent_run_text_deliveries_recovery_idx
  ON agent_run_text_deliveries (status, updated_at);

CREATE TABLE IF NOT EXISTS agent_run_text_delivery_attempts (
  run_id TEXT NOT NULL
    REFERENCES agent_run_text_deliveries(run_id) ON DELETE CASCADE,
  delivery_attempt INTEGER NOT NULL CHECK (delivery_attempt BETWEEN 1 AND 3),
  delivery_attempt_token TEXT NOT NULL CHECK (
    length(delivery_attempt_token) BETWEEN 1 AND 512
    AND delivery_attempt_token = btrim(delivery_attempt_token)
  ),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, delivery_attempt),
  UNIQUE (delivery_attempt_token)
);
