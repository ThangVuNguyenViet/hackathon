ALTER TABLE conversation_turns ADD COLUMN metadata TEXT;

CREATE TABLE IF NOT EXISTS conversation_profiles (
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  profile_source TEXT NOT NULL,
  profile_updated_at TEXT NOT NULL,
  PRIMARY KEY (channel, external_user_id)
);
