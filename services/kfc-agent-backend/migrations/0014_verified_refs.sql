CREATE TABLE IF NOT EXISTS verified_refs (
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'kfc-verified-ref-v1'),
  ref_id TEXT PRIMARY KEY
    CHECK (length(ref_id) = 36),
  kind TEXT NOT NULL
    CHECK (
      kind IN (
        'fulfillment_address',
        'saved_address',
        'payment_method',
        'selected_action_effect'
      )
    ),
  session_id TEXT NOT NULL
    CHECK (length(session_id) > 0),
  session_generation INTEGER NOT NULL
    CHECK (session_generation >= 0),
  customer_id TEXT NOT NULL
    CHECK (length(customer_id) > 0),
  channel TEXT NOT NULL
    CHECK (
      channel IN (
        'messenger',
        'zalo',
        'kfc',
        'messenger_mock',
        'zalo_mock'
      )
    ),
  authenticated_subject TEXT NOT NULL
    CHECK (length(authenticated_subject) > 0),
  authentication_evidence_ref TEXT NOT NULL
    CHECK (length(authentication_evidence_ref) > 0),
  verified_revision TEXT NOT NULL
    CHECK (
      length(verified_revision) = 64
      AND verified_revision NOT GLOB '*[^0-9a-f]*'
    ),
  lifecycle TEXT NOT NULL
    CHECK (lifecycle IN ('replayable', 'one_shot')),
  payload_json TEXT NOT NULL
    CHECK (
      json_valid(payload_json)
      AND json_type(payload_json) = 'object'
    ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
    CHECK (created_at < expires_at),
  claimed_use_id TEXT,
  claimed_at TEXT,
  CHECK (
    (claimed_use_id IS NULL AND claimed_at IS NULL)
    OR (
      claimed_use_id IS NOT NULL
      AND length(claimed_use_id) > 0
      AND claimed_at IS NOT NULL
      AND claimed_at >= created_at
      AND claimed_at < expires_at
    )
  ),
  CHECK (
    lifecycle = 'one_shot'
    OR (claimed_use_id IS NULL AND claimed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS verified_refs_session_idx
  ON verified_refs (session_id, session_generation);

CREATE INDEX IF NOT EXISTS verified_refs_expiry_idx
  ON verified_refs (expires_at);
