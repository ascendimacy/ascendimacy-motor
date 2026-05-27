/**
 * drill-repo — persistência + carregamento de banks para B2 (Drilling).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b2-drilling-primer-v0.md
 *
 * Tabelas:
 *  - `drill_states`  → estado per (persona_id, item_id), com SR + mastery.
 *  - `drill_attempts` → log append-only por audit/análise.
 *
 * `loadBank(bankId)` lê fixture YAML e denormaliza `bank_id` em cada item.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import yaml from "js-yaml";
import type Database from "better-sqlite3";
import {
  DEFAULT_EASINESS,
  DrillBankSchema,
  isMastered,
  nextInterval,
  type DrillBank,
  type DrillItem,
  type DrillResponse,
  type DrillState,
  type SrResponse,
} from "@ascendimacy/shared";
import { getNow } from "./clock.js";

export const DRILL_STATES_DDL = `
CREATE TABLE IF NOT EXISTS drill_states (
  persona_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  presented_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  next_due_at TEXT NOT NULL,
  current_interval_days REAL NOT NULL DEFAULT 0,
  current_easiness REAL NOT NULL DEFAULT 2.5,
  mastery_reached_at TEXT,
  last_5_attempts_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (persona_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_drill_states_due ON drill_states(persona_id, next_due_at);
CREATE INDEX IF NOT EXISTS idx_drill_states_mastery ON drill_states(persona_id, mastery_reached_at);

CREATE TABLE IF NOT EXISTS drill_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  response TEXT NOT NULL,
  latency_ms INTEGER,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drill_attempts_persona ON drill_attempts(persona_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_drill_attempts_item ON drill_attempts(persona_id, item_id, attempted_at);
`;

interface DrillStateRow {
  persona_id: string;
  item_id: string;
  presented_count: number;
  correct_count: number;
  last_seen_at: string;
  next_due_at: string;
  current_interval_days: number;
  current_easiness: number;
  mastery_reached_at: string | null;
  last_5_attempts_json: string;
}

export interface DrillAttemptRow {
  id: number;
  persona_id: string;
  item_id: string;
  response: DrillResponse;
  latency_ms: number | null;
  attempted_at: string;
}

const DEFAULT_BANKS_ROOT = "fixtures/banks";

function rowToState(row: DrillStateRow): DrillState {
  return {
    persona_id: row.persona_id,
    item_id: row.item_id,
    presented_count: row.presented_count,
    correct_count: row.correct_count,
    last_seen_at: row.last_seen_at,
    next_due_at: row.next_due_at,
    current_interval_days: row.current_interval_days,
    current_easiness: row.current_easiness,
    mastery_reached_at: row.mastery_reached_at,
    last_5_attempts: JSON.parse(row.last_5_attempts_json) as DrillResponse[],
  };
}

function addDays(iso: string, days: number): string {
  const t = new Date(iso).getTime();
  return new Date(t + days * 86_400_000).toISOString();
}

/**
 * Carrega banco YAML.
 * - Se `bankIdOrPath` for absoluto → usa direto.
 * - Se terminar em `.yaml` → resolve relativo a `opts.root` (default `fixtures/banks`).
 * - Caso contrário → resolve `{root}/{bankId}.yaml`.
 *
 * Retorna `{bank, items}`. Items vêm com `bank_id` injetado (denormalizado).
 */
export function loadBank(
  bankIdOrPath: string,
  opts: { root?: string } = {},
): { bank: DrillBank; items: DrillItem[] } {
  const root = opts.root ?? DEFAULT_BANKS_ROOT;
  const path = isAbsolute(bankIdOrPath)
    ? bankIdOrPath
    : bankIdOrPath.endsWith(".yaml")
      ? resolve(root, bankIdOrPath)
      : resolve(root, `${bankIdOrPath}.yaml`);
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw);
  const bank = DrillBankSchema.parse(parsed);
  const items: DrillItem[] = bank.items.map((it) => ({
    ...it,
    bank_id: bank.bank_id,
  }));
  return { bank, items };
}

export function getState(
  db: Database.Database,
  personaId: string,
  itemId: string,
): DrillState | null {
  const row = db
    .prepare("SELECT * FROM drill_states WHERE persona_id = ? AND item_id = ?")
    .get(personaId, itemId) as DrillStateRow | undefined;
  return row ? rowToState(row) : null;
}

function saveState(db: Database.Database, state: DrillState): void {
  db.prepare(
    `INSERT OR REPLACE INTO drill_states
      (persona_id, item_id, presented_count, correct_count,
       last_seen_at, next_due_at, current_interval_days, current_easiness,
       mastery_reached_at, last_5_attempts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    state.persona_id,
    state.item_id,
    state.presented_count,
    state.correct_count,
    state.last_seen_at,
    state.next_due_at,
    state.current_interval_days,
    state.current_easiness,
    state.mastery_reached_at ?? null,
    JSON.stringify(state.last_5_attempts),
  );
}

/**
 * Registra uma tentativa: insere em `drill_attempts` (audit log) e atualiza
 * o `drill_states` correspondente via SM-2. Retorna o state pós-update.
 *
 * - `timeout` é mapeado para `incorrect` no algoritmo SR (intervalo reset).
 * - `mastery_reached_at` é gravado uma única vez (evento, não estado).
 */
export function recordAttempt(
  db: Database.Database,
  args: {
    personaId: string;
    itemId: string;
    response: DrillResponse;
    latencyMs?: number;
    nowIso?: string;
  },
): DrillState {
  const ts = getNow(args.nowIso);

  db.prepare(
    `INSERT INTO drill_attempts (persona_id, item_id, response, latency_ms, attempted_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    args.personaId,
    args.itemId,
    args.response,
    args.latencyMs ?? null,
    ts,
  );

  const prior: DrillState = getState(db, args.personaId, args.itemId) ?? {
    persona_id: args.personaId,
    item_id: args.itemId,
    presented_count: 0,
    correct_count: 0,
    last_seen_at: ts,
    next_due_at: ts,
    current_interval_days: 0,
    current_easiness: DEFAULT_EASINESS,
    mastery_reached_at: null,
    last_5_attempts: [],
  };

  const srResponse: SrResponse =
    args.response === "timeout" ? "incorrect" : args.response;
  const { next_interval_days, next_easiness } = nextInterval(prior, srResponse);

  const newLast5: DrillResponse[] = [
    ...prior.last_5_attempts,
    args.response,
  ].slice(-5);

  const wasCorrect =
    args.response === "correct" || args.response === "slow_correct";

  const updated: DrillState = {
    ...prior,
    presented_count: prior.presented_count + 1,
    correct_count: prior.correct_count + (wasCorrect ? 1 : 0),
    last_seen_at: ts,
    next_due_at: addDays(ts, next_interval_days),
    current_interval_days: next_interval_days,
    current_easiness: next_easiness,
    last_5_attempts: newLast5,
  };

  if (!updated.mastery_reached_at && isMastered(updated)) {
    updated.mastery_reached_at = ts;
  }

  saveState(db, updated);
  return updated;
}

export function listDue(
  db: Database.Database,
  personaId: string,
  nowIso?: string,
): DrillState[] {
  const now = getNow(nowIso);
  const rows = db
    .prepare(
      `SELECT * FROM drill_states
       WHERE persona_id = ? AND next_due_at <= ?
       ORDER BY next_due_at ASC`,
    )
    .all(personaId, now) as DrillStateRow[];
  return rows.map(rowToState);
}

export function listMastered(
  db: Database.Database,
  personaId: string,
): DrillState[] {
  const rows = db
    .prepare(
      `SELECT * FROM drill_states
       WHERE persona_id = ? AND mastery_reached_at IS NOT NULL
       ORDER BY mastery_reached_at ASC`,
    )
    .all(personaId) as DrillStateRow[];
  return rows.map(rowToState);
}

export function listAttempts(
  db: Database.Database,
  personaId: string,
  itemId?: string,
): DrillAttemptRow[] {
  if (itemId !== undefined) {
    return db
      .prepare(
        `SELECT * FROM drill_attempts
         WHERE persona_id = ? AND item_id = ?
         ORDER BY attempted_at ASC, id ASC`,
      )
      .all(personaId, itemId) as DrillAttemptRow[];
  }
  return db
    .prepare(
      `SELECT * FROM drill_attempts
       WHERE persona_id = ?
       ORDER BY attempted_at ASC, id ASC`,
    )
    .all(personaId) as DrillAttemptRow[];
}
