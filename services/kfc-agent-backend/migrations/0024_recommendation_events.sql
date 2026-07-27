CREATE TABLE recommendation_request_reservations (
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
  request_id TEXT NOT NULL CHECK (length(request_id) > 0),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64
    AND request_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  owner_token TEXT NOT NULL CHECK (length(owner_token) > 0),
  response_json TEXT CHECK (
    response_json IS NULL OR json_valid(response_json)
  ),
  technical_json TEXT CHECK (
    technical_json IS NULL OR json_valid(technical_json)
  ),
  recommendation_id TEXT,
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  completed_at TEXT,
  PRIMARY KEY (session_id, idempotency_key),
  UNIQUE (request_id),
  CHECK (
    (
      status = 'pending'
      AND response_json IS NULL
      AND technical_json IS NULL
      AND recommendation_id IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      status = 'completed'
      AND response_json IS NOT NULL
      AND technical_json IS NOT NULL
      AND recommendation_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE TABLE recommendation_decisions (
  recommendation_id TEXT PRIMARY KEY CHECK (length(recommendation_id) > 0),
  request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) > 0),
  order_flow_id TEXT NOT NULL CHECK (length(order_flow_id) > 0),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  placement TEXT NOT NULL CHECK (
    placement IN (
      'local_favorite',
      'for_you',
      'modifier_upsell',
      'smart_cross_sell'
    )
  ),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  technical_json TEXT NOT NULL CHECK (json_valid(technical_json)),
  action_digest TEXT NOT NULL CHECK (
    length(action_digest) = 64
    AND action_digest NOT GLOB '*[^a-f0-9]*'
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64
    AND request_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  state_revision_before INTEGER NOT NULL CHECK (state_revision_before >= 0),
  state_revision_after INTEGER NOT NULL CHECK (
    state_revision_after > state_revision_before
  ),
  recorded_at TEXT NOT NULL CHECK (length(recorded_at) > 0)
);

CREATE INDEX recommendation_decisions_order_flow_recorded_idx
  ON recommendation_decisions (order_flow_id, recorded_at, recommendation_id);

CREATE TABLE recommendation_events (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) > 0),
  event_fingerprint TEXT NOT NULL CHECK (
    length(event_fingerprint) = 64
    AND event_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'kfc-recommendation-event-v1'
  ),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'decision_requested',
      'decision_completed',
      'candidate_eligibility_summary',
      'impression_rendered',
      'selected',
      'explicitly_dismissed',
      'ignored',
      'superseded',
      'cart_mutation_succeeded',
      'cart_mutation_failed',
      'checkout_completed',
      'order_abandoned',
      'order_cancelled'
    )
  ),
  recommendation_id TEXT,
  request_id TEXT NOT NULL CHECK (length(request_id) > 0),
  order_flow_id TEXT NOT NULL CHECK (length(order_flow_id) > 0),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  placement TEXT NOT NULL CHECK (
    placement IN (
      'local_favorite',
      'for_you',
      'modifier_upsell',
      'smart_cross_sell'
    )
  ),
  occurred_at TEXT NOT NULL CHECK (length(occurred_at) > 0),
  recorded_at TEXT NOT NULL CHECK (length(recorded_at) > 0),
  actor TEXT NOT NULL CHECK (actor IN ('customer', 'agent', 'system', 'client')),
  action_id TEXT,
  cart_revision TEXT,
  version_bindings_json TEXT NOT NULL CHECK (
    json_valid(version_bindings_json)
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX recommendation_events_order_flow_occurred_idx
  ON recommendation_events (order_flow_id, occurred_at, event_id);

CREATE INDEX recommendation_events_recommendation_occurred_idx
  ON recommendation_events (recommendation_id, occurred_at, event_id);

CREATE INDEX recommendation_events_session_occurred_idx
  ON recommendation_events (session_id, occurred_at, event_id);
