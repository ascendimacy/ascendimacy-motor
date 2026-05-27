/**
 * kids_declared_objectives — repo append-only de objetivos declarados.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s1-objetivos-declarados-v0.md
 *
 * Convenção: nenhuma row é alterada após inserida. Mudanças de status criam
 * nova versão linkada via `parent_objective_id`. "Latest version" de uma
 * cadeia é a row cujo id não é referenciado por nenhum parent_objective_id.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  DeclaredObjectiveSchema,
  type DeclaredObjective,
  type DeclaredObjectiveDraft,
  type DeclaredObjectiveStatus,
} from "@ascendimacy/shared";

export const DECLARED_OBJECTIVES_DDL = `
CREATE TABLE IF NOT EXISTS kids_declared_objectives (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  declared_in_session TEXT NOT NULL,
  target_date TEXT NOT NULL,
  statement TEXT NOT NULL,
  axis TEXT,
  status TEXT NOT NULL,
  parent_objective_id TEXT,
  evidence_event_ids TEXT,
  drift_check_due_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_declared_objectives_by_persona
  ON kids_declared_objectives(persona_id);
CREATE INDEX IF NOT EXISTS idx_declared_objectives_by_status
  ON kids_declared_objectives(status);
CREATE INDEX IF NOT EXISTS idx_declared_objectives_by_parent
  ON kids_declared_objectives(parent_objective_id);
CREATE INDEX IF NOT EXISTS idx_declared_objectives_by_drift_due
  ON kids_declared_objectives(drift_check_due_at);
`;

interface ObjectiveRow {
  id: string;
  persona_id: string;
  declared_at: string;
  declared_in_session: string;
  target_date: string;
  statement: string;
  axis: string | null;
  status: string;
  parent_objective_id: string | null;
  evidence_event_ids: string | null;
  drift_check_due_at: string | null;
}

function rowToObjective(row: ObjectiveRow): DeclaredObjective {
  const evidence = row.evidence_event_ids
    ? (JSON.parse(row.evidence_event_ids) as string[])
    : undefined;
  return DeclaredObjectiveSchema.parse({
    id: row.id,
    persona_id: row.persona_id,
    declared_at: row.declared_at,
    declared_in_session: row.declared_in_session,
    target_date: row.target_date,
    statement: row.statement,
    ...(row.axis !== null ? { axis: row.axis } : {}),
    status: row.status,
    ...(row.parent_objective_id !== null
      ? { parent_objective_id: row.parent_objective_id }
      : {}),
    ...(evidence !== undefined ? { evidence_event_ids: evidence } : {}),
    ...(row.drift_check_due_at !== null
      ? { drift_check_due_at: row.drift_check_due_at }
      : {}),
  });
}

function insert(db: Database.Database, obj: DeclaredObjective): void {
  db.prepare(
    `INSERT INTO kids_declared_objectives
      (id, persona_id, declared_at, declared_in_session, target_date,
       statement, axis, status, parent_objective_id, evidence_event_ids,
       drift_check_due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    obj.id,
    obj.persona_id,
    obj.declared_at,
    obj.declared_in_session,
    obj.target_date,
    obj.statement,
    obj.axis ?? null,
    obj.status,
    obj.parent_objective_id ?? null,
    obj.evidence_event_ids !== undefined
      ? JSON.stringify(obj.evidence_event_ids)
      : null,
    obj.drift_check_due_at ?? null,
  );
}

function getById(db: Database.Database, id: string): DeclaredObjective | null {
  const row = db
    .prepare("SELECT * FROM kids_declared_objectives WHERE id = ?")
    .get(id) as ObjectiveRow | undefined;
  return row ? rowToObjective(row) : null;
}

export function createObjective(
  db: Database.Database,
  input: DeclaredObjectiveDraft,
): DeclaredObjective {
  const objective: DeclaredObjective = {
    id: randomUUID(),
    persona_id: input.persona_id,
    declared_at: input.declared_at,
    declared_in_session: input.declared_in_session,
    target_date: input.target_date,
    statement: input.statement,
    ...(input.axis !== undefined ? { axis: input.axis } : {}),
    status: "active",
    ...(input.evidence_event_ids !== undefined
      ? { evidence_event_ids: input.evidence_event_ids }
      : {}),
    ...(input.drift_check_due_at !== undefined
      ? { drift_check_due_at: input.drift_check_due_at }
      : {}),
  };
  insert(db, objective);
  return objective;
}

/**
 * Marca objective antigo como "revised" criando nova row no chain.
 *
 * `newId` é o id da nova row "revised" (deve ser único). Tipicamente
 * gerado pelo caller que separadamente também cria o objetivo de
 * substituição via createObjective.
 */
export function markRevised(
  db: Database.Database,
  oldId: string,
  newId: string,
): DeclaredObjective {
  const old = getById(db, oldId);
  if (old === null) {
    throw new Error(`markRevised: objective ${oldId} not found`);
  }
  const revised: DeclaredObjective = {
    ...old,
    id: newId,
    status: "revised",
    parent_objective_id: oldId,
  };
  insert(db, revised);
  return revised;
}

/**
 * Atualiza status criando nova row linkada via parent_objective_id.
 * Mantém append-only: row antiga continua existindo.
 */
export function updateStatus(
  db: Database.Database,
  id: string,
  status: DeclaredObjectiveStatus,
  evidenceEventIds?: string[],
): DeclaredObjective {
  const current = getById(db, id);
  if (current === null) {
    throw new Error(`updateStatus: objective ${id} not found`);
  }
  const mergedEvidence =
    evidenceEventIds !== undefined
      ? [...(current.evidence_event_ids ?? []), ...evidenceEventIds]
      : current.evidence_event_ids;
  const next: DeclaredObjective = {
    ...current,
    id: randomUUID(),
    status,
    parent_objective_id: id,
    ...(mergedEvidence !== undefined
      ? { evidence_event_ids: mergedEvidence }
      : {}),
  };
  insert(db, next);
  return next;
}

/**
 * Active = rows com status='active' que não foram superseded por outra
 * versão na cadeia (id não referenciado por nenhum parent_objective_id).
 */
export function listActive(
  db: Database.Database,
  personaId: string,
): DeclaredObjective[] {
  const rows = db
    .prepare(
      `SELECT * FROM kids_declared_objectives
       WHERE persona_id = ?
         AND status = 'active'
         AND id NOT IN (
           SELECT parent_objective_id FROM kids_declared_objectives
           WHERE parent_objective_id IS NOT NULL
         )
       ORDER BY declared_at`,
    )
    .all(personaId) as ObjectiveRow[];
  return rows.map(rowToObjective);
}

/**
 * Drift check due: rows active com drift_check_due_at < now,
 * que não foram superseded.
 */
export function findDueForDriftCheck(
  db: Database.Database,
  now: string,
): DeclaredObjective[] {
  const rows = db
    .prepare(
      `SELECT * FROM kids_declared_objectives
       WHERE status = 'active'
         AND drift_check_due_at IS NOT NULL
         AND drift_check_due_at < ?
         AND id NOT IN (
           SELECT parent_objective_id FROM kids_declared_objectives
           WHERE parent_objective_id IS NOT NULL
         )
       ORDER BY drift_check_due_at`,
    )
    .all(now) as ObjectiveRow[];
  return rows.map(rowToObjective);
}

export function getDeclaredObjective(
  db: Database.Database,
  id: string,
): DeclaredObjective | null {
  return getById(db, id);
}
