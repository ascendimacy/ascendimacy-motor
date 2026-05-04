/**
 * kids_helix_state — persistência do Double Helix CASEL state por criança.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-22-double-helix-mapping.md §5
 * Handoff: ascendimacy-ops/docs/handoffs/2026-05-04-helix-integration-handoff.md
 * Issue: motor#66 [H1]
 *
 * Pattern: stand-alone functions + DDL const string (idêntico cards-repo.ts).
 *
 * Nota terminológica: schema usa `child_id`; HelixState tem campo `userId`.
 * Convenção neste contexto: `userId === child_id`. MCP tools aceitam
 * `childId` na API; load/save mapeiam pra/de userId no domain object.
 */

import type Database from "better-sqlite3";
import type { HelixState, CaselDim, CaselLevel, DeferredEntry } from "@ascendimacy/shared";
import type { HelixRepo } from "@ascendimacy/shared";

export const HELIX_STATE_DDL = `
CREATE TABLE IF NOT EXISTS kids_helix_state (
  child_id TEXT PRIMARY KEY,
  active_dimension TEXT NOT NULL,
  active_level TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  cycle_day INTEGER NOT NULL DEFAULT 1,
  cycle_start TEXT NOT NULL,
  previous_dimension TEXT,
  retrieval_done INTEGER NOT NULL DEFAULT 0,
  estimated_cycle_days INTEGER NOT NULL DEFAULT 18,
  queue_json TEXT NOT NULL DEFAULT '[]',
  deferred_json TEXT NOT NULL DEFAULT '[]',
  completed_json TEXT NOT NULL DEFAULT '[]',
  vacation_mode_active INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`;

interface HelixRow {
  child_id: string;
  active_dimension: string;
  active_level: string;
  progress: number;
  cycle_day: number;
  cycle_start: string;
  previous_dimension: string | null;
  retrieval_done: number;
  estimated_cycle_days: number;
  queue_json: string;
  deferred_json: string;
  completed_json: string;
  vacation_mode_active: number;
  updated_at: string;
}

function rowToState(row: HelixRow): HelixState {
  return {
    userId: row.child_id,
    activeDimension: row.active_dimension as CaselDim,
    activeLevel: row.active_level as CaselLevel,
    progress: row.progress,
    cycleDay: row.cycle_day,
    cycleStart: row.cycle_start,
    previousDimension: row.previous_dimension as CaselDim | null,
    retrievalDone: row.retrieval_done === 1,
    estimatedCycleDays: row.estimated_cycle_days,
    queue: JSON.parse(row.queue_json) as CaselDim[],
    deferred: JSON.parse(row.deferred_json) as DeferredEntry[],
    completed: JSON.parse(row.completed_json) as CaselDim[],
    vacationModeActive: row.vacation_mode_active === 1,
  };
}

/** Lê estado do child. Retorna null se não inicializado. */
export function loadHelixState(db: Database.Database, childId: string): HelixState | null {
  const row = db.prepare("SELECT * FROM kids_helix_state WHERE child_id = ?").get(childId) as HelixRow | undefined;
  return row ? rowToState(row) : null;
}

/** Persiste estado (upsert por child_id). */
export function saveHelixState(db: Database.Database, state: HelixState): void {
  db.prepare(
    `INSERT INTO kids_helix_state (
       child_id, active_dimension, active_level, progress, cycle_day, cycle_start,
       previous_dimension, retrieval_done, estimated_cycle_days,
       queue_json, deferred_json, completed_json, vacation_mode_active, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(child_id) DO UPDATE SET
       active_dimension = excluded.active_dimension,
       active_level = excluded.active_level,
       progress = excluded.progress,
       cycle_day = excluded.cycle_day,
       cycle_start = excluded.cycle_start,
       previous_dimension = excluded.previous_dimension,
       retrieval_done = excluded.retrieval_done,
       estimated_cycle_days = excluded.estimated_cycle_days,
       queue_json = excluded.queue_json,
       deferred_json = excluded.deferred_json,
       completed_json = excluded.completed_json,
       vacation_mode_active = excluded.vacation_mode_active,
       updated_at = excluded.updated_at`,
  ).run(
    state.userId,
    state.activeDimension,
    state.activeLevel,
    state.progress,
    state.cycleDay,
    state.cycleStart,
    state.previousDimension,
    state.retrievalDone ? 1 : 0,
    state.estimatedCycleDays,
    JSON.stringify(state.queue),
    JSON.stringify(state.deferred),
    JSON.stringify(state.completed),
    state.vacationModeActive ? 1 : 0,
    new Date().toISOString(),
  );
}

/** Adapter SQLite → HelixRepo (interface do shared, pra orchestrator). */
export function sqliteHelixRepo(db: Database.Database): HelixRepo {
  return {
    async load(userId) {
      return loadHelixState(db, userId);
    },
    async save(state) {
      saveHelixState(db, state);
    },
  };
}
