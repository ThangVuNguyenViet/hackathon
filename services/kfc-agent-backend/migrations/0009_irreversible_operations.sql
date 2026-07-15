CREATE TABLE IF NOT EXISTS irreversible_operations (
  request_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  binding_fingerprint TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
