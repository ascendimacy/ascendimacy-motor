/**
 * SQLite índice derivado do BFF — C-MX-08 (S-OC-30, D-OC-14 storage híbrido).
 *
 * Source-of-truth = trace JSON files em `~/ascendimacy-motor/traces/`.
 * Esse índice acelera filter/search/aggregation pra session library
 * (PR6+). Rebuilt do filesystem no startup ou via watcher.
 *
 * PR2 entrega só o schema. Population pelos PRs 6+ (session library) e
 * 8+ (Edit Learner v0 telemetria).
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

const SCHEMA_SQL = `
-- Session library (S-OC-30/31/32)
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('real', 'sts')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  has_overrides INTEGER NOT NULL DEFAULT 0,
  trace_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_persona ON sessions(persona_id);
CREATE INDEX IF NOT EXISTS idx_sessions_kind ON sessions(kind);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

-- Full-text search das mensagens (filter + search S-OC-31)
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_id UNINDEXED,
  turn UNINDEXED,
  role UNINDEXED,
  text,
  tokenize = 'unicode61'
);

-- Edit Learner v0 (DS-04 motor, S-OC-10/11)
CREATE TABLE IF NOT EXISTS jun_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN (
    'approve', 'edit', 'reject', 'override', 'auto'
  )),
  original_text TEXT,
  final_text TEXT,
  override_card_id TEXT,
  rationale TEXT,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jun_decisions_session
  ON jun_decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_jun_decisions_decision
  ON jun_decisions(decision);

-- Debug mode telemetria (S-OC-29, V0.1 tail-only)
CREATE TABLE IF NOT EXISTS debug_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  llm_call_id TEXT,
  action TEXT NOT NULL,
  original_prompt_hash TEXT,
  edited_prompt_hash TEXT,
  swap_to TEXT,
  rationale TEXT,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debug_actions_session
  ON debug_actions(session_id);
`;

export interface InitDbOptions {
  /** Path do arquivo SQLite. Use `":memory:"` em testes. */
  dbPath: string;
}

export function initDb(opts: InitDbOptions): DatabaseType {
  const db = new Database(opts.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}
