CREATE TABLE IF NOT EXISTS session_generations (
  session_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation >= 0)
);

DROP TABLE IF EXISTS confirmation_pauses;
DROP TABLE IF EXISTS confirmation_pause_sessions;
