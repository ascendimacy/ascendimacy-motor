-- Idempotent migration: add child_id to sessions table (SQLite 3.35+)
-- A-03 GAP-08: multi-turn cross-session memory
-- child_id links a session to a logical child identity across multiple runs.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS child_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_child_id ON sessions (child_id);
