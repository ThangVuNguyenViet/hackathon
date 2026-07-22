CREATE TABLE IF NOT EXISTS confirmation_pause_sessions (
  session_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation >= 0)
);

CREATE TABLE IF NOT EXISTS confirmation_pauses (
  schema_version TEXT NOT NULL,
  request_id TEXT PRIMARY KEY,
  checkpoint_thread_id TEXT NOT NULL,
  checkpoint_namespace TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
  pause_identity_digest TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  action_json TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  approval_binding_json TEXT NOT NULL,
  approval_binding_digest TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  authenticated_subject TEXT NOT NULL,
  authentication_evidence_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'rejected', 'expired')),
  rejection_receipt_id TEXT,
  rejection_receipt_json TEXT,
  rejected_at TEXT,
  completion_status TEXT NOT NULL CHECK (completion_status IN ('pending', 'completed', 'failed')),
  result_json TEXT,
  completion_error TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS confirmation_pauses_session_idx
  ON confirmation_pauses (session_id, created_at);
