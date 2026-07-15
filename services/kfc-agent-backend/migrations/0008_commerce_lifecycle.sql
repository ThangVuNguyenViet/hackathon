CREATE TABLE IF NOT EXISTS commerce_lifecycle_instances (
  instance_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  scenario_definition_version TEXT NOT NULL,
  release_id TEXT NOT NULL,
  catalog_observation_id TEXT NOT NULL,
  catalog_hash TEXT NOT NULL,
  customer_binding TEXT NOT NULL,
  session_binding TEXT NOT NULL,
  payment_policy TEXT NOT NULL CHECK (payment_policy IN ('prepaid', 'pay_on_fulfillment')),
  fulfillment_policy TEXT NOT NULL CHECK (fulfillment_policy IN ('delivery', 'pickup')),
  logical_time INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  sealed_at INTEGER,
  reset_from TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS commerce_lifecycle_binding_idx
  ON commerce_lifecycle_instances (environment, customer_binding, session_binding);

CREATE TABLE IF NOT EXISTS commerce_lifecycle_events (
  instance_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  logical_time INTEGER NOT NULL,
  trace_id TEXT,
  run_id TEXT,
  request_id TEXT,
  environment TEXT NOT NULL,
  scenario_definition_version TEXT NOT NULL,
  release_id TEXT NOT NULL,
  catalog_observation_id TEXT NOT NULL,
  catalog_hash TEXT NOT NULL,
  customer_binding TEXT NOT NULL,
  session_binding TEXT NOT NULL,
  prior_revision INTEGER,
  idempotency_key TEXT,
  request_fingerprint TEXT,
  actor TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id),
  FOREIGN KEY (instance_id) REFERENCES commerce_lifecycle_instances(instance_id)
);

CREATE INDEX IF NOT EXISTS commerce_lifecycle_events_revision_idx
  ON commerce_lifecycle_events (instance_id, revision, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_lifecycle_single_reset_idx
  ON commerce_lifecycle_instances (reset_from)
  WHERE reset_from IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_lifecycle_idempotency (
  instance_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  fault_json TEXT,
  committed INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, idempotency_key),
  FOREIGN KEY (instance_id) REFERENCES commerce_lifecycle_instances(instance_id)
);

CREATE TABLE IF NOT EXISTS commerce_lifecycle_faults (
  instance_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  fault_type TEXT NOT NULL,
  phase TEXT NOT NULL,
  one_shot INTEGER NOT NULL,
  configured_revision INTEGER NOT NULL,
  base_occurrence INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, operation, configured_revision),
  FOREIGN KEY (instance_id) REFERENCES commerce_lifecycle_instances(instance_id)
);

CREATE TABLE IF NOT EXISTS commerce_lifecycle_operation_occurrences (
  instance_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  PRIMARY KEY (instance_id, operation),
  FOREIGN KEY (instance_id) REFERENCES commerce_lifecycle_instances(instance_id)
);

CREATE TABLE IF NOT EXISTS commerce_lifecycle_command_claims (
  command_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (instance_id, expected_revision),
  FOREIGN KEY (instance_id) REFERENCES commerce_lifecycle_instances(instance_id)
);
