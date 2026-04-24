/**
 * kids_gardner_program — estado persistido do programa Dual Helix de 5 semanas.
 *
 * Spec:
 *   - ascendimacy-ops/docs/fundamentos/ebrota-kids-fundamentos.md §6
 *   - ascendimacy-ops/docs/specs/2026-04-24-ebrota-learning-mechanics-paper.md §4.2-4.3
 *
 * Schema: 1 row por sessão (session_id UNIQUE). Reflete estado "onde estamos"
 * no arco de 5 semanas; não é log de eventos (o event_log cuida disso).
 */

import type Database from "better-sqlite3";
import type { GardnerProgramState, ProgramPhase } from "@ascendimacy/shared";
import { nextPhase, isAssessmentReady } from "@ascendimacy/shared";
import type { GardnerAssessment } from "@ascendimacy/shared";

export const GARDNER_PROGRAM_DDL = `
CREATE TABLE IF NOT EXISTS kids_gardner_program (
  session_id TEXT PRIMARY KEY,
  current_week INTEGER,
  current_day INTEGER NOT NULL DEFAULT 1,
  current_phase TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT,
  phases_completed INTEGER NOT NULL DEFAULT 0,
  consecutive_missed_milestones INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  updated_at TEXT NOT NULL
);
`;

interface ProgramRow {
  session_id: string;
  current_week: number | null;
  current_day: number;
  current_phase: string | null;
  paused: number;
  paused_reason: string | null;
  phases_completed: number;
  consecutive_missed_milestones: number;
  started_at: string | null;
  updated_at: string;
}

function rowToState(row: ProgramRow): GardnerProgramState {
  return {
    current_week: row.current_week,
    current_day: row.current_day,
    current_phase: (row.current_phase as ProgramPhase | null) ?? null,
    paused: row.paused === 1,
    paused_reason: row.paused_reason ?? undefined,
    phases_completed: row.phases_completed,
    consecutive_missed_milestones: row.consecutive_missed_milestones,
    started_at: row.started_at ?? undefined,
    updated_at: row.updated_at,
  };
}

/**
 * Estado default de um programa que ainda não foi iniciado (sem row).
 * `current_week=null` + `current_phase=null` indica "pré-programa".
 */
export function defaultProgramState(now: string): GardnerProgramState {
  return {
    current_week: null,
    current_day: 1,
    current_phase: null,
    paused: false,
    phases_completed: 0,
    consecutive_missed_milestones: 0,
    updated_at: now,
  };
}

/**
 * Lê o estado atual do programa pra uma sessão.
 * Se ainda não houver row, retorna defaultProgramState.
 */
export function getProgramState(
  db: Database.Database,
  sessionId: string,
): GardnerProgramState {
  const row = db
    .prepare("SELECT * FROM kids_gardner_program WHERE session_id = ?")
    .get(sessionId) as ProgramRow | undefined;
  if (!row) return defaultProgramState(new Date().toISOString());
  return rowToState(row);
}

/**
 * Inicia o programa — cria row se ausente, define week=1 phase=1.
 * No-op se já está iniciado (current_week !== null).
 * Exige assessment pronto (min 3 sessões) — caller deve checar antes.
 */
export function startProgram(
  db: Database.Database,
  sessionId: string,
  now?: string,
): GardnerProgramState {
  const ts = now ?? new Date().toISOString();
  const existing = getProgramState(db, sessionId);
  if (existing.current_week !== null) return existing;
  db.prepare(
    `INSERT INTO kids_gardner_program
      (session_id, current_week, current_day, current_phase, paused,
       phases_completed, consecutive_missed_milestones, started_at, updated_at)
     VALUES (?, 1, 1, 'exploration_in_strength', 0, 0, 0, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       current_week = 1,
       current_day = 1,
       current_phase = 'exploration_in_strength',
       paused = 0,
       paused_reason = NULL,
       phases_completed = 0,
       started_at = COALESCE(kids_gardner_program.started_at, excluded.started_at),
       updated_at = excluded.updated_at`,
  ).run(sessionId, ts, ts);
  return getProgramState(db, sessionId);
}

/**
 * Avança programa pela próxima fase (usa `nextPhase` puro do shared).
 * Throws se programa pausado — caller deve resumir antes.
 */
export function advanceProgram(
  db: Database.Database,
  sessionId: string,
  now?: string,
): GardnerProgramState {
  const ts = now ?? new Date().toISOString();
  const current = getProgramState(db, sessionId);
  if (current.paused) {
    throw new Error("advanceProgram: program is paused; resume first");
  }
  const next = nextPhase(current);
  upsertProgram(db, sessionId, next, ts);
  return getProgramState(db, sessionId);
}

/** Pausa explicitamente (motivo livre). */
export function pauseProgram(
  db: Database.Database,
  sessionId: string,
  reason: string,
  now?: string,
): GardnerProgramState {
  const ts = now ?? new Date().toISOString();
  const current = getProgramState(db, sessionId);
  upsertProgram(db, sessionId, { ...current, paused: true, paused_reason: reason }, ts);
  return getProgramState(db, sessionId);
}

/** Resume programa pausado. */
export function resumeProgram(
  db: Database.Database,
  sessionId: string,
  now?: string,
): GardnerProgramState {
  const ts = now ?? new Date().toISOString();
  const current = getProgramState(db, sessionId);
  upsertProgram(
    db,
    sessionId,
    { ...current, paused: false, paused_reason: undefined },
    ts,
  );
  return getProgramState(db, sessionId);
}

/** Incrementa milestones faltantes — dispara pause parental se ≥2. */
export function recordMissedMilestone(
  db: Database.Database,
  sessionId: string,
  now?: string,
): GardnerProgramState {
  const ts = now ?? new Date().toISOString();
  const current = getProgramState(db, sessionId);
  const next = current.consecutive_missed_milestones + 1;
  const shouldPause = next >= 2;
  upsertProgram(
    db,
    sessionId,
    {
      ...current,
      consecutive_missed_milestones: next,
      paused: shouldPause ? true : current.paused,
      paused_reason: shouldPause ? "missed_milestones" : current.paused_reason,
    },
    ts,
  );
  return getProgramState(db, sessionId);
}

/** Reseta o contador de milestones faltantes (após fase completada). */
export function resetMissedMilestones(
  db: Database.Database,
  sessionId: string,
  now?: string,
): void {
  const ts = now ?? new Date().toISOString();
  const current = getProgramState(db, sessionId);
  upsertProgram(
    db,
    sessionId,
    { ...current, consecutive_missed_milestones: 0 },
    ts,
  );
}

function upsertProgram(
  db: Database.Database,
  sessionId: string,
  state: GardnerProgramState,
  ts: string,
): void {
  db.prepare(
    `INSERT INTO kids_gardner_program
      (session_id, current_week, current_day, current_phase, paused, paused_reason,
       phases_completed, consecutive_missed_milestones, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       current_week = excluded.current_week,
       current_day = excluded.current_day,
       current_phase = excluded.current_phase,
       paused = excluded.paused,
       paused_reason = excluded.paused_reason,
       phases_completed = excluded.phases_completed,
       consecutive_missed_milestones = excluded.consecutive_missed_milestones,
       started_at = COALESCE(kids_gardner_program.started_at, excluded.started_at),
       updated_at = excluded.updated_at`,
  ).run(
    sessionId,
    state.current_week ?? null,
    state.current_day,
    state.current_phase ?? null,
    state.paused ? 1 : 0,
    state.paused_reason ?? null,
    state.phases_completed,
    state.consecutive_missed_milestones,
    state.started_at ?? ts,
    ts,
  );
}

/** Helper: verifica se assessment pronto (delega pro shared). */
export function canActivate(assessment: GardnerAssessment | undefined): boolean {
  return isAssessmentReady(assessment);
}
