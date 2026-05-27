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
import { EMITTED_CARDS_DDL } from "@ascendimacy/motor-execucao/cards-repo";
import { DRILL_STATES_DDL } from "@ascendimacy/motor-execucao/drill-repo";
import { NARRATIVE_THREADS_DDL } from "@ascendimacy/motor-execucao/narrative-thread-repo";

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

-- Subject Knowledge — fundação pedagógica eBrota (spec 2026-05-25, Fase 1).
-- Cross-session ledger por sujeito. Append-only. Schema-only nesta fase —
-- writers (Discovery, Boundary, ConceptLedger, RecallCheck) entregues em
-- Fases 2/3/5.
CREATE TABLE IF NOT EXISTS subject_knowledge (
  id            TEXT PRIMARY KEY,
  subject_id    TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN (
    'interest', 'value', 'need', 'discovery',
    'boundary_event', 'presented_concept',
    'recall_check_attempt', 'vertical_affinity_signal',
    'axis_attempt_outcome'
  )),
  source        TEXT NOT NULL CHECK(source IN (
    'self_declared', 'parent_claimed', 'motor_inferred'
  )),
  confidence    REAL NOT NULL,
  confirmed_at  TEXT,
  alignment     TEXT NOT NULL DEFAULT 'unknown' CHECK(alignment IN (
    'aligned', 'neutral', 'divergent', 'unknown'
  )),
  payload_json  TEXT NOT NULL,
  turn_ref      TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sk_subject_type
  ON subject_knowledge(subject_id, type);
CREATE INDEX IF NOT EXISTS idx_sk_session
  ON subject_knowledge(session_id);
CREATE INDEX IF NOT EXISTS idx_sk_created_at
  ON subject_knowledge(created_at);

-- Sujeito-proposto materializado por subject_id. Derivado de
-- parental_profile.aspirations + complementos clássicos. Versionado.
CREATE TABLE IF NOT EXISTS subject_proposed (
  subject_id            TEXT PRIMARY KEY,
  version               INTEGER NOT NULL DEFAULT 1,
  axes_active           TEXT NOT NULL,
  complements_per_axis  TEXT NOT NULL,
  reasoning_log         TEXT NOT NULL,
  ratified_at           TEXT,
  last_modified_at      TEXT NOT NULL
);

-- Sinais de afinidade com verticais (eixos/tradições) — pista pra flashes
-- culturais e pra sugestões de ajuste no sujeito-proposto.
CREATE TABLE IF NOT EXISTS vertical_affinity_signals (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL,
  vertical_kind   TEXT NOT NULL CHECK(vertical_kind IN ('axis', 'lineage')),
  vertical_id     TEXT NOT NULL,
  score_affinity  REAL NOT NULL,
  evidence_count  INTEGER NOT NULL DEFAULT 1,
  last_seen_at    TEXT NOT NULL,
  in_base         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vas_subject
  ON vertical_affinity_signals(subject_id);
CREATE INDEX IF NOT EXISTS idx_vas_score
  ON vertical_affinity_signals(score_affinity);

-- Journey State — Fase 8 PR 1 (spec 2026-05-25 §3 + §10.1).
-- Estado da jornada cross-session por sujeito (stage atual, discoveries
-- contadas pro threshold, override parental). Atualizado lazy na leitura
-- a partir de subject_knowledge.
CREATE TABLE IF NOT EXISTS journey_state (
  subject_id            TEXT PRIMARY KEY,
  stage                 TEXT NOT NULL DEFAULT 'discovery_only' CHECK(stage IN (
    'discovery_only', 'mapping_ready', 'applied_double_helix'
  )),
  stage_entered_at      TEXT NOT NULL,
  discoveries_count     INTEGER NOT NULL DEFAULT 0,
  families_covered      TEXT NOT NULL DEFAULT '[]',
  override_by_parent    TEXT,
  last_updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journey_stage ON journey_state(stage);

-- StrategyPlan — Fase 8 PR 3 (spec 2026-05-25 §5 + §10.2).
-- 1 plan por sessão em journey_stage=applied_double_helix. Composto pelo
-- Strategist no início (challenge_explain) e referenciado durante execute.
-- demonstrations_observed atualizado no follow_up.
CREATE TABLE IF NOT EXISTS strategy_plans (
  session_id                    TEXT PRIMARY KEY,
  subject_id                    TEXT NOT NULL,
  composed_at                   TEXT NOT NULL,
  target_demonstrations_json    TEXT NOT NULL,
  playbook_composition_json     TEXT NOT NULL,
  overall_success_criteria      TEXT,
  fallback_strategy             TEXT,
  subject_map_snapshot_json     TEXT,
  demonstrations_observed_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_strategy_plans_subject
  ON strategy_plans(subject_id);
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
  // B1/B2 wiring — aplica DDLs do motor-execucao para que reads via BFF
  // não falhem com "no such table" em personas sem dados ainda.
  db.exec(EMITTED_CARDS_DDL);
  db.exec(DRILL_STATES_DDL);
  db.exec(NARRATIVE_THREADS_DDL);
  return db;
}
