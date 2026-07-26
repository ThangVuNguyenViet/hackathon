CREATE TABLE IF NOT EXISTS agent_session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  item_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_session_items_session_id_idx
  ON agent_session_items (session_id, id);
