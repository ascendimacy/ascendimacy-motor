/**
 * kids_helix_state — persistência SQLite do Double Helix cycle engine
 * (G-05, ops#1091). Sibling pattern de `kids_gardner_program`.
 *
 * Schema: 1 row por persona_id (UNIQUE). State machine puro vive em
 * `planejador/src/strategist/helix-engine.ts`; este arquivo é só repo +
 * DDL + bootstrap.
 *
 * Spec: ops#1091 sub-decisão 1 ratified Jun 2026-05-16.
 */

import type Database from "better-sqlite3";
import type {
  CaselDimension,
  CaselDimensionPair,
  KidsHelixCadenceTrigger,
  KidsHelixMode,
  KidsHelixState,
  KidsHelixVacationTrigger,
} from "@ascendimacy/shared";
import {
  defaultKidsHelixState,
  KIDS_HELIX_CADENCE_TRIGGERS,
  KIDS_HELIX_MODES,
  KIDS_HELIX_VACATION_TRIGGERS,
} from "@ascendimacy/shared";
import { getNow } from "./clock.js";

export const KIDS_HELIX_STATE_DDL = `
CREATE TABLE IF NOT EXISTS kids_helix_state (
  persona_id TEXT PRIMARY KEY,
  active_pair_0 TEXT NOT NULL,
  active_pair_1 TEXT NOT NULL,
  cycle_started_at TEXT NOT NULL,
  current_day INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'active',
  previous_pair_0 TEXT,
  previous_pair_1 TEXT,
  cycles_completed INTEGER NOT NULL DEFAULT 0,
  queue_csv TEXT NOT NULL DEFAULT '',
  completed_csv TEXT NOT NULL DEFAULT '',
  deferred_csv TEXT NOT NULL DEFAULT '',
  vacation_trigger TEXT,
  vacation_started_at TEXT,
  triggers_fired_csv TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
`;

/**
 * G-07 (ops#1020) — migração idempotente pra databases pré-G-07 que não
 * têm a coluna `triggers_fired_csv`. Usa try/catch porque `ALTER TABLE`
 * em SQLite não suporta `IF NOT EXISTS` para colunas.
 *
 * Chamada automaticamente em `getKidsHelixState`/`updateKidsHelixState`
 * via `ensureG07Migration` — efetivamente self-healing.
 */
const ENSURE_G07_COLUMN_SQL = `
ALTER TABLE kids_helix_state ADD COLUMN triggers_fired_csv TEXT NOT NULL DEFAULT ''
`;

let g07MigrationApplied = false;

function ensureG07Migration(db: Database.Database): void {
  if (g07MigrationApplied) return;
  try {
    db.exec(ENSURE_G07_COLUMN_SQL);
  } catch (err) {
    // "duplicate column name" = já migrado (caminho dominante pós-DDL nova).
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(msg)) {
      throw err;
    }
  }
  g07MigrationApplied = true;
}

/**
 * Reset cache pra testes (cada test isolation cria DB novo, então flag
 * cached precisa reset). Exportado pra test-only consumption.
 */
export function _resetG07MigrationFlagForTests(): void {
  g07MigrationApplied = false;
}

interface KidsHelixRow {
  persona_id: string;
  active_pair_0: string;
  active_pair_1: string;
  cycle_started_at: string;
  current_day: number;
  mode: string;
  previous_pair_0: string | null;
  previous_pair_1: string | null;
  cycles_completed: number;
  queue_csv: string;
  completed_csv: string;
  deferred_csv: string;
  vacation_trigger: string | null;
  vacation_started_at: string | null;
  /** G-07: CSV de KidsHelixCadenceTrigger fireados no ciclo atual. */
  triggers_fired_csv: string | null;
  updated_at: string;
}

function csvToDims(csv: string): CaselDimension[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is CaselDimension =>
      s === "SA" || s === "SM" || s === "SOC" || s === "REL" || s === "DM",
    );
}

function dimsToCsv(dims: CaselDimension[]): string {
  return dims.join(",");
}

function isMode(value: string): value is KidsHelixMode {
  return (KIDS_HELIX_MODES as readonly string[]).includes(value);
}

function isVacationTrigger(value: string): value is KidsHelixVacationTrigger {
  return (KIDS_HELIX_VACATION_TRIGGERS as readonly string[]).includes(value);
}

function isCadenceTrigger(
  value: string,
): value is KidsHelixCadenceTrigger {
  return (KIDS_HELIX_CADENCE_TRIGGERS as readonly string[]).includes(value);
}

function csvToTriggers(csv: string | null): KidsHelixCadenceTrigger[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter(isCadenceTrigger);
}

function triggersToCsv(triggers: KidsHelixCadenceTrigger[]): string {
  return triggers.join(",");
}

function rowToState(row: KidsHelixRow): KidsHelixState {
  const pair: CaselDimensionPair = [
    row.active_pair_0 as CaselDimension,
    row.active_pair_1 as CaselDimension,
  ];
  const prev: CaselDimensionPair | null =
    row.previous_pair_0 && row.previous_pair_1
      ? [
          row.previous_pair_0 as CaselDimension,
          row.previous_pair_1 as CaselDimension,
        ]
      : null;
  return {
    persona_id: row.persona_id,
    active_pair: pair,
    cycle_started_at: row.cycle_started_at,
    current_day: row.current_day,
    mode: isMode(row.mode) ? row.mode : "active",
    previous_pair: prev,
    cycles_completed: row.cycles_completed,
    queue: csvToDims(row.queue_csv),
    completed: csvToDims(row.completed_csv),
    deferred: csvToDims(row.deferred_csv),
    vacation_trigger:
      row.vacation_trigger && isVacationTrigger(row.vacation_trigger)
        ? row.vacation_trigger
        : null,
    vacation_started_at: row.vacation_started_at,
    triggers_fired_this_cycle: csvToTriggers(row.triggers_fired_csv),
    updated_at: row.updated_at,
  };
}

/**
 * Lê estado atual do helix pra uma persona. Se ausente, retorna null —
 * caller decide se bootstrap (via `bootstrapKidsHelixStateRow`) ou erro.
 */
export function getKidsHelixState(
  db: Database.Database,
  personaId: string,
): KidsHelixState | null {
  ensureG07Migration(db);
  const row = db
    .prepare("SELECT * FROM kids_helix_state WHERE persona_id = ?")
    .get(personaId) as KidsHelixRow | undefined;
  if (!row) return null;
  return rowToState(row);
}

/**
 * Persist (upsert) state — sobrescreve por persona_id.
 *
 * Caller (orchestrator) chama após qualquer state transition do helix-engine
 * (cycleStart, dayAdvance, completeCycle, defer/resume, enter/exit vacation).
 */
export function updateKidsHelixState(
  db: Database.Database,
  state: KidsHelixState,
  nowIso?: string,
): KidsHelixState {
  ensureG07Migration(db);
  const ts = getNow(nowIso);
  const updated = { ...state, updated_at: ts };
  db.prepare(
    `INSERT INTO kids_helix_state
      (persona_id, active_pair_0, active_pair_1, cycle_started_at, current_day,
       mode, previous_pair_0, previous_pair_1, cycles_completed, queue_csv,
       completed_csv, deferred_csv, vacation_trigger, vacation_started_at,
       triggers_fired_csv, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(persona_id) DO UPDATE SET
       active_pair_0 = excluded.active_pair_0,
       active_pair_1 = excluded.active_pair_1,
       cycle_started_at = excluded.cycle_started_at,
       current_day = excluded.current_day,
       mode = excluded.mode,
       previous_pair_0 = excluded.previous_pair_0,
       previous_pair_1 = excluded.previous_pair_1,
       cycles_completed = excluded.cycles_completed,
       queue_csv = excluded.queue_csv,
       completed_csv = excluded.completed_csv,
       deferred_csv = excluded.deferred_csv,
       vacation_trigger = excluded.vacation_trigger,
       vacation_started_at = excluded.vacation_started_at,
       triggers_fired_csv = excluded.triggers_fired_csv,
       updated_at = excluded.updated_at`,
  ).run(
    updated.persona_id,
    updated.active_pair[0],
    updated.active_pair[1],
    updated.cycle_started_at,
    updated.current_day,
    updated.mode,
    updated.previous_pair?.[0] ?? null,
    updated.previous_pair?.[1] ?? null,
    updated.cycles_completed,
    dimsToCsv(updated.queue),
    dimsToCsv(updated.completed),
    dimsToCsv(updated.deferred),
    updated.vacation_trigger ?? null,
    updated.vacation_started_at ?? null,
    triggersToCsv(updated.triggers_fired_this_cycle),
    updated.updated_at,
  );
  return updated;
}

/**
 * Bootstrap row pra persona nova. Wrapper de `defaultKidsHelixState` que
 * persiste + retorna state criado.
 *
 * Idempotente: se row já existe, retorna existing (não sobrescreve).
 *
 * Sub-decisão 2: caller passa `firstPair` opcional resolvido externamente
 * (via `computeInitialPair` do helix-engine ou hardcoded pra testes).
 * Fallback SA+SOC já implícito em `defaultKidsHelixState`.
 */
export function bootstrapKidsHelixStateRow(
  db: Database.Database,
  args: {
    personaId: string;
    firstPair?: CaselDimensionPair;
    nowIso?: string;
  },
): KidsHelixState {
  const existing = getKidsHelixState(db, args.personaId);
  if (existing) return existing;
  const ts = getNow(args.nowIso);
  const fresh = defaultKidsHelixState({
    personaId: args.personaId,
    nowIso: ts,
    firstPair: args.firstPair,
  });
  return updateKidsHelixState(db, fresh, ts);
}
