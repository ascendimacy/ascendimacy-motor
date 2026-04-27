-- Up Migration
-- F1 bootstrap (motor#40): tabelas pra primitives de SessionState.
--
-- Spec: ascendimacy-ops/docs/specs/2026-04-27-statevector-primitives-inventory-f1.md
-- + 2026-04-27-ebrota-to-motor-canonical-migration.md (MIG-06: postgres)
--
-- Idempotente via IF NOT EXISTS. CHECK constraints honram invariantes
-- documentadas (status-matrix tri-state, mood 1-10, conversation role).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- users: cache de trust + perfil basal.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  age INT NOT NULL CHECK (age >= 0 AND age <= 18),
  trust_level NUMERIC(3,2) NOT NULL DEFAULT 0.33 CHECK (trust_level >= 0 AND trust_level <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- sessions: budget remaining + boundaries.
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_remaining NUMERIC(5,2) NOT NULL DEFAULT 15,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- status_matrix: brejo/baia/pasto por dimensão (DT-STATUS-01: tabela própria).
CREATE TABLE IF NOT EXISTS status_matrix (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('brejo', 'baia', 'pasto')),
  last_transition_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, dimension)
);

-- conversations: history pra computeMoodWindow + mood absoluto por turn.
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  mood INT CHECK (mood >= 1 AND mood <= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- helix_state: Double Helix CASEL completo (DT-HELIX-01=A).
-- queue/deferred/completed em JSONB pra flexibilidade.
CREATE TABLE IF NOT EXISTS helix_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_dimension TEXT NOT NULL,
  active_level TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  cycle_start DATE NOT NULL DEFAULT CURRENT_DATE,
  cycle_day INT NOT NULL DEFAULT 1,
  retrieval_done BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_cycle_days INT NOT NULL DEFAULT 18,
  queue JSONB NOT NULL DEFAULT '[]',
  deferred JSONB NOT NULL DEFAULT '[]',
  completed JSONB NOT NULL DEFAULT '[]',
  previous_dimension TEXT,
  vacation_mode_active BOOLEAN NOT NULL DEFAULT FALSE
);

-- Down Migration
DROP TABLE IF EXISTS helix_state;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS status_matrix;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
