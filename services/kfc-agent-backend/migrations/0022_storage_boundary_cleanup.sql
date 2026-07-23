DROP TABLE IF EXISTS conversation_events;

CREATE TABLE IF NOT EXISTS catalog_pin_projections (
  session_id TEXT PRIMARY KEY,
  observation_json TEXT NOT NULL CHECK (json_valid(observation_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sandbox_proof_sessions (
  session_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  authenticated INTEGER NOT NULL CHECK (authenticated IN (0, 1)),
  expires_at TEXT NOT NULL,
  order_id TEXT,
  provider_profile_json TEXT CHECK (
    provider_profile_json IS NULL OR json_valid(provider_profile_json)
  ),
  created_at TEXT NOT NULL
);
