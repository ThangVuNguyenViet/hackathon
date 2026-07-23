PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS non_agent_text_deliveries (
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'kfc-non-agent-text-delivery-v1'),
  request_key TEXT PRIMARY KEY CHECK (
    length(request_key) = 64
    AND request_key NOT GLOB '*[^0-9a-f]*'
  ),
  session_binding_digest TEXT NOT NULL CHECK (
    length(session_binding_digest) = 64
    AND session_binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
  reserved_session_authority_generation INTEGER NOT NULL
    CHECK (reserved_session_authority_generation >= 0),
  channel TEXT NOT NULL CHECK (channel IN ('kfc', 'messenger', 'zalo')),
  assistant_turn_id TEXT NOT NULL CHECK (
    length(assistant_turn_id) BETWEEN 1 AND 512
    AND assistant_turn_id = trim(assistant_turn_id)
  ),
  agent_binding_digest TEXT NOT NULL CHECK (
    length(agent_binding_digest) = 64
    AND agent_binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
  recipient_binding_digest TEXT NOT NULL CHECK (
    length(recipient_binding_digest) = 64
    AND recipient_binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
  presentation_binding_digest TEXT NOT NULL CHECK (
    length(presentation_binding_digest) = 64
    AND presentation_binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
  delivery_binding_digest TEXT NOT NULL CHECK (
    length(delivery_binding_digest) = 64
    AND delivery_binding_digest NOT GLOB '*[^0-9a-f]*'
  ),
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
  sending_lease_expires_at TEXT,
  provider_message_id TEXT,
  outcome_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
      AND (
        channel = 'kfc'
        OR provider_message_id IS NOT NULL
      )
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
  ),
  CHECK (
    delivery_attempt_token IS NULL
    OR (
      length(delivery_attempt_token) BETWEEN 1 AND 512
      AND delivery_attempt_token = trim(delivery_attempt_token)
    )
  ),
  CHECK (
    sending_lease_expires_at IS NULL
    OR strftime(
      '%Y-%m-%dT%H:%M:%fZ',
      sending_lease_expires_at
    ) = sending_lease_expires_at
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
  ),
  CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
    AND updated_at >= created_at
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
  delivery_attempt_token TEXT NOT NULL UNIQUE CHECK (
    length(delivery_attempt_token) BETWEEN 1 AND 512
    AND delivery_attempt_token = trim(delivery_attempt_token)
  ),
  created_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
  ),
  PRIMARY KEY (request_key, delivery_attempt)
);
