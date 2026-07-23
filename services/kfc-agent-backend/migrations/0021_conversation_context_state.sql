ALTER TABLE conversation_turns ADD COLUMN ordinal INTEGER;

UPDATE conversation_turns AS target
SET ordinal = (
  SELECT COUNT(*)
  FROM conversation_turns AS candidate
  WHERE candidate.session_id = target.session_id
    AND (
      candidate.created_at < target.created_at
      OR (
        candidate.created_at = target.created_at
        AND candidate.id <= target.id
      )
    )
)
WHERE ordinal IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_session_ordinal_idx
  ON conversation_turns (session_id, ordinal);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  session_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  text TEXT NOT NULL,
  through_ordinal INTEGER NOT NULL CHECK (through_ordinal > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_state_projections (
  session_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, pack_id, pack_version)
);
