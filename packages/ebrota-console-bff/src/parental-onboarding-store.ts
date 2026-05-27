/**
 * Parental Onboarding Store (US-PO-01..11).
 *
 * Persiste o draft do wizard parental enquanto Yuji (ou outro adquirente)
 * preenche. Idempotente — múltiplos POST /parental/onboarding/draft com
 * mesmo `acquirerId` sobrescrevem.
 *
 * Source of truth final é `fixtures/parental-profile-<acquirerId>.yaml`
 * escrito por `/parental/onboarding/complete`. SQLite serve só pro
 * estado intermediário + retomada de sessão.
 */

import type { Database as DatabaseType } from "better-sqlite3";

export const PARENTAL_ONBOARDING_SCHEMA = `
CREATE TABLE IF NOT EXISTS parental_onboarding (
  acquirer_id   TEXT PRIMARY KEY,
  step          INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN (
    'in_progress', 'complete'
  )),
  state_json    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);
`;

export interface OnboardingRecord {
  acquirerId: string;
  step: number;
  status: "in_progress" | "complete";
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface OnboardingRow {
  acquirer_id: string;
  step: number;
  status: "in_progress" | "complete";
  state_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function initParentalOnboardingSchema(db: DatabaseType): void {
  db.exec(PARENTAL_ONBOARDING_SCHEMA);
}

function deriveAcquirerId(state: Record<string, unknown>): string {
  const family = (state.family ?? {}) as Record<string, unknown>;
  const acquirer = (family.acquirer ?? {}) as Record<string, unknown>;
  if (typeof acquirer.id === "string" && acquirer.id.length > 0) {
    return acquirer.id;
  }
  if (typeof acquirer.name === "string" && acquirer.name.length > 0) {
    return acquirer.name.toLowerCase().replace(/\s+/g, "-");
  }
  return "anonymous";
}

export function saveDraft(
  db: DatabaseType,
  state: Record<string, unknown>,
): OnboardingRecord {
  const acquirerId = deriveAcquirerId(state);
  const step = typeof state.step === "number" ? state.step : 1;
  const stateJson = JSON.stringify(state);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO parental_onboarding (acquirer_id, step, status, state_json, created_at, updated_at)
     VALUES (?, ?, 'in_progress', ?, ?, ?)
     ON CONFLICT(acquirer_id) DO UPDATE SET
       step = excluded.step,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`,
  ).run(acquirerId, step, stateJson, now, now);
  return readRecord(db, acquirerId)!;
}

export function markComplete(
  db: DatabaseType,
  state: Record<string, unknown>,
): OnboardingRecord {
  const acquirerId = deriveAcquirerId(state);
  const stateJson = JSON.stringify({ ...state, readyForPilot: true });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO parental_onboarding (acquirer_id, step, status, state_json, created_at, updated_at, completed_at)
     VALUES (?, 11, 'complete', ?, ?, ?, ?)
     ON CONFLICT(acquirer_id) DO UPDATE SET
       step = 11,
       status = 'complete',
       state_json = excluded.state_json,
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at`,
  ).run(acquirerId, stateJson, now, now, now);
  return readRecord(db, acquirerId)!;
}

export function readRecord(
  db: DatabaseType,
  acquirerId: string,
): OnboardingRecord | null {
  const row = db
    .prepare(
      `SELECT acquirer_id, step, status, state_json, created_at, updated_at, completed_at
       FROM parental_onboarding WHERE acquirer_id = ?`,
    )
    .get(acquirerId) as OnboardingRow | undefined;
  if (!row) return null;
  return {
    acquirerId: row.acquirer_id,
    step: row.step,
    status: row.status,
    state: JSON.parse(row.state_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/** Lista o registro mais recente (V0 — assume 1 adquirente ativo). */
export function readLatest(db: DatabaseType): OnboardingRecord | null {
  const row = db
    .prepare(
      `SELECT acquirer_id, step, status, state_json, created_at, updated_at, completed_at
       FROM parental_onboarding ORDER BY updated_at DESC LIMIT 1`,
    )
    .get() as OnboardingRow | undefined;
  if (!row) return null;
  return {
    acquirerId: row.acquirer_id,
    step: row.step,
    status: row.status,
    state: JSON.parse(row.state_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
