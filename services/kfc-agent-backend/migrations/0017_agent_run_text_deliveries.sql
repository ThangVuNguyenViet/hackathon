PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_run_text_deliveries (
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'kfc-agent-run-text-delivery-v1'),
  run_id TEXT PRIMARY KEY CHECK (
    length(run_id) BETWEEN 1 AND 512
    AND run_id = trim(run_id)
  )
    REFERENCES agent_runs(id) ON DELETE CASCADE,
  run_execution_attempt INTEGER NOT NULL
    CHECK (run_execution_attempt BETWEEN 1 AND 3),
  run_execution_origin_attempt INTEGER NOT NULL CHECK (
    run_execution_origin_attempt BETWEEN 1 AND 3
    AND run_execution_origin_attempt <= run_execution_attempt
  ),
  run_execution_lease_token TEXT NOT NULL
    CHECK (
      length(run_execution_lease_token) BETWEEN 1 AND 512
      AND run_execution_lease_token = trim(run_execution_lease_token)
    ),
  run_execution_lease_token_digest TEXT NOT NULL CHECK (
    length(run_execution_lease_token_digest) = 64
    AND run_execution_lease_token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  prior_run_execution_lease_token_digests TEXT NOT NULL DEFAULT '[]'
    CHECK (
      json_valid(prior_run_execution_lease_token_digests)
      AND json_type(prior_run_execution_lease_token_digests) = 'array'
      AND json_array_length(
        prior_run_execution_lease_token_digests
      ) = run_execution_attempt - run_execution_origin_attempt
    ),
  channel TEXT NOT NULL CHECK (channel IN ('messenger', 'zalo')),
  assistant_turn_id TEXT NOT NULL UNIQUE CHECK (
    length(assistant_turn_id) BETWEEN 1 AND 512
    AND assistant_turn_id = trim(assistant_turn_id)
  )
    REFERENCES conversation_turns(id),
  recipient_binding_digest TEXT NOT NULL
    CHECK (
      length(recipient_binding_digest) = 64
      AND recipient_binding_digest NOT GLOB '*[^0-9a-f]*'
    ),
  presentation_binding_digest TEXT NOT NULL
    CHECK (
      length(presentation_binding_digest) = 64
      AND presentation_binding_digest NOT GLOB '*[^0-9a-f]*'
    ),
  delivery_binding_digest TEXT NOT NULL
    CHECK (
      length(delivery_binding_digest) = 64
      AND delivery_binding_digest NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'sending',
      'confirmed_not_sent',
      'confirmed_sent',
      'delivery_outcome_unknown'
    )
  ),
  delivery_attempt INTEGER NOT NULL
    CHECK (delivery_attempt BETWEEN 0 AND 3),
  last_delivery_run_execution_attempt INTEGER CHECK (
    last_delivery_run_execution_attempt IS NULL
    OR last_delivery_run_execution_attempt BETWEEN 1 AND 3
  ),
  delivery_attempt_token TEXT,
  provider_message_id TEXT,
  outcome_code TEXT,
  created_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
    AND
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
  ),
  updated_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL
    AND
    strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
    AND updated_at >= created_at
  ),
  CHECK (
    (
      status = 'pending'
      AND delivery_attempt = 0
      AND last_delivery_run_execution_attempt IS NULL
      AND delivery_attempt_token IS NULL
      AND provider_message_id IS NULL
      AND outcome_code IS NULL
    )
    OR (
      status = 'sending'
      AND delivery_attempt BETWEEN 1 AND 3
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND last_delivery_run_execution_attempt = run_execution_attempt
      AND delivery_attempt_token IS NOT NULL
      AND provider_message_id IS NULL
      AND outcome_code IS NULL
    )
    OR (
      status = 'confirmed_not_sent'
      AND delivery_attempt BETWEEN 1 AND 3
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND (
        last_delivery_run_execution_attempt = run_execution_attempt
        OR last_delivery_run_execution_attempt + 1 =
          run_execution_attempt
      )
      AND delivery_attempt_token IS NOT NULL
      AND provider_message_id IS NULL
      AND outcome_code IS NOT NULL
    )
    OR (
      status = 'confirmed_sent'
      AND delivery_attempt BETWEEN 1 AND 3
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND last_delivery_run_execution_attempt = run_execution_attempt
      AND delivery_attempt_token IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND outcome_code IS NULL
    )
    OR (
      status = 'delivery_outcome_unknown'
      AND delivery_attempt BETWEEN 1 AND 3
      AND last_delivery_run_execution_attempt IS NOT NULL
      AND last_delivery_run_execution_attempt = run_execution_attempt
      AND delivery_attempt_token IS NOT NULL
      AND provider_message_id IS NULL
      AND outcome_code IS NOT NULL
    )
  ),
  CHECK (
    delivery_attempt_token IS NULL
    OR (
      length(delivery_attempt_token) BETWEEN 1 AND 512
      AND delivery_attempt_token = trim(delivery_attempt_token)
    )
  ),
  CHECK (
    provider_message_id IS NULL
    OR (
      length(provider_message_id) BETWEEN 1 AND 512
      AND provider_message_id = trim(provider_message_id)
    )
  ),
  CHECK (
    outcome_code IS NULL
    OR (
      length(outcome_code) BETWEEN 1 AND 256
      AND outcome_code = trim(outcome_code)
    )
  )
);

CREATE INDEX IF NOT EXISTS agent_run_text_deliveries_recovery_idx
  ON agent_run_text_deliveries (status, updated_at);

CREATE TABLE IF NOT EXISTS agent_run_text_delivery_attempts (
  run_id TEXT NOT NULL
    REFERENCES agent_run_text_deliveries(run_id) ON DELETE CASCADE,
  delivery_attempt INTEGER NOT NULL
    CHECK (delivery_attempt BETWEEN 1 AND 3),
  delivery_attempt_token TEXT NOT NULL
    CHECK (
      length(delivery_attempt_token) BETWEEN 1 AND 512
      AND delivery_attempt_token = trim(delivery_attempt_token)
  ),
  created_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
    AND
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
  ),
  PRIMARY KEY (run_id, delivery_attempt),
  UNIQUE (delivery_attempt_token)
);
