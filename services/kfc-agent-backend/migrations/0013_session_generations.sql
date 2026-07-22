CREATE TABLE IF NOT EXISTS session_generations (
  session_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation >= 0)
);
