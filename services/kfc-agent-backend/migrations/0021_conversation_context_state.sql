PRAGMA foreign_keys = OFF;

CREATE TABLE conversation_turns_with_ordinals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  channel TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  external_message_id TEXT,
  external_user_id TEXT,
  delivery_status TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO conversation_turns_with_ordinals (
  id, session_id, ordinal, channel, role, text, external_message_id,
  external_user_id, delivery_status, metadata, created_at
)
SELECT
  id,
  session_id,
  ROW_NUMBER() OVER (
    PARTITION BY session_id
    ORDER BY created_at ASC, id ASC
  ),
  channel,
  role,
  text,
  external_message_id,
  external_user_id,
  delivery_status,
  metadata,
  created_at
FROM conversation_turns;

DROP TABLE conversation_turns;
ALTER TABLE conversation_turns_with_ordinals RENAME TO conversation_turns;

CREATE UNIQUE INDEX conversation_turns_session_external_message_idx
  ON conversation_turns (session_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX conversation_turns_session_created_idx
  ON conversation_turns (session_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX conversation_turns_session_ordinal_idx
  ON conversation_turns (session_id, ordinal);

CREATE TABLE conversation_summaries (
  session_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  text TEXT NOT NULL,
  through_ordinal INTEGER NOT NULL CHECK (through_ordinal > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE pack_state_projections (
  session_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, pack_id, pack_version)
);

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
