CREATE INDEX IF NOT EXISTS dashboard_events_created_idx
  ON dashboard_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS dashboard_events_session_created_idx
  ON dashboard_events (session_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS conversation_profiles_profile_updated_idx
  ON conversation_profiles (profile_updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_turns_session_created_idx
  ON conversation_turns (session_id, created_at DESC, id DESC);
