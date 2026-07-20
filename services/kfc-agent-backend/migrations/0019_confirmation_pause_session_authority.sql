ALTER TABLE confirmation_pauses
  ADD COLUMN session_authority_generation INTEGER NOT NULL DEFAULT 0
  CHECK (session_authority_generation >= 0);

CREATE INDEX IF NOT EXISTS confirmation_pauses_authority_idx
  ON confirmation_pauses (
    session_id,
    session_authority_generation,
    request_id
  );
