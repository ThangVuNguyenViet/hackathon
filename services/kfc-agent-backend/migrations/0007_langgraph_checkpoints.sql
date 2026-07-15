CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  checkpoint_type TEXT NOT NULL,
  checkpoint_blob BLOB NOT NULL,
  metadata_type TEXT NOT NULL,
  metadata_blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS langgraph_checkpoints_latest_idx
  ON langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id DESC);

CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  write_index INTEGER NOT NULL,
  channel TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_blob BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_index)
);

CREATE INDEX IF NOT EXISTS langgraph_checkpoint_writes_checkpoint_idx
  ON langgraph_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id);
