/**
 * mc1_scheduled — persistência da primeira mensagem (MC1) aprovada por
 * Yuji no wizard parental, aguardando entrega na próxima janela temporal.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-19-mc1-primeira-mensagem-brota-jp.md
 *
 * Lifecycle:
 *   pending   ── tickScheduler detecta janela aberta ──▶ delivered
 *      └──── parental cancel ──▶ cancelled
 *
 * 1 entry por (persona_id, target_window_name). Re-schedule cria nova row
 * (history preservada). listPendingByPersona retorna apenas status=pending.
 */

import type Database from "better-sqlite3";

export const MC1_SCHEDULED_DDL = `
CREATE TABLE IF NOT EXISTS mc1_scheduled (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id      TEXT NOT NULL,
  approved_text   TEXT NOT NULL,
  target_window_name TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('pending','delivered','cancelled')),
  delivered_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_mc1_scheduled_persona ON mc1_scheduled(persona_id);
CREATE INDEX IF NOT EXISTS idx_mc1_scheduled_status ON mc1_scheduled(status);
`;

export type Mc1Status = "pending" | "delivered" | "cancelled";

export interface Mc1ScheduledRecord {
  id: number;
  personaId: string;
  approvedText: string;
  targetWindowName: string;
  scheduledAt: string;
  status: Mc1Status;
  deliveredAt: string | null;
}

interface Mc1Row {
  id: number;
  persona_id: string;
  approved_text: string;
  target_window_name: string;
  scheduled_at: string;
  status: Mc1Status;
  delivered_at: string | null;
}

function rowToRecord(row: Mc1Row): Mc1ScheduledRecord {
  return {
    id: row.id,
    personaId: row.persona_id,
    approvedText: row.approved_text,
    targetWindowName: row.target_window_name,
    scheduledAt: row.scheduled_at,
    status: row.status,
    deliveredAt: row.delivered_at,
  };
}

export function initMc1Schema(db: Database.Database): void {
  db.exec(MC1_SCHEDULED_DDL);
}

export interface ScheduleMc1Input {
  personaId: string;
  approvedText: string;
  targetWindowName: string;
  /** ISO; default = now. */
  scheduledAt?: string;
}

/**
 * Persiste uma MC1 aprovada como pending. Não dedupica: caller pode
 * cancelar pending anterior antes se quiser reschedule idempotente.
 */
export function scheduleMc1(
  db: Database.Database,
  input: ScheduleMc1Input,
): Mc1ScheduledRecord {
  const scheduledAt = input.scheduledAt ?? new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO mc1_scheduled
         (persona_id, approved_text, target_window_name, scheduled_at, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
    .run(
      input.personaId,
      input.approvedText,
      input.targetWindowName,
      scheduledAt,
    );
  const id = Number(result.lastInsertRowid);
  return {
    id,
    personaId: input.personaId,
    approvedText: input.approvedText,
    targetWindowName: input.targetWindowName,
    scheduledAt,
    status: "pending",
    deliveredAt: null,
  };
}

/** Retorna a MC1 pending mais antiga pra persona (FIFO), ou null. */
export function nextPendingByPersona(
  db: Database.Database,
  personaId: string,
): Mc1ScheduledRecord | null {
  const row = db
    .prepare(
      `SELECT id, persona_id, approved_text, target_window_name,
              scheduled_at, status, delivered_at
         FROM mc1_scheduled
        WHERE persona_id = ? AND status = 'pending'
        ORDER BY scheduled_at ASC
        LIMIT 1`,
    )
    .get(personaId) as Mc1Row | undefined;
  return row ? rowToRecord(row) : null;
}

export function listPending(db: Database.Database): Mc1ScheduledRecord[] {
  const rows = db
    .prepare(
      `SELECT id, persona_id, approved_text, target_window_name,
              scheduled_at, status, delivered_at
         FROM mc1_scheduled
        WHERE status = 'pending'
        ORDER BY scheduled_at ASC`,
    )
    .all() as Mc1Row[];
  return rows.map(rowToRecord);
}

export function getById(
  db: Database.Database,
  id: number,
): Mc1ScheduledRecord | null {
  const row = db
    .prepare(
      `SELECT id, persona_id, approved_text, target_window_name,
              scheduled_at, status, delivered_at
         FROM mc1_scheduled
        WHERE id = ?`,
    )
    .get(id) as Mc1Row | undefined;
  return row ? rowToRecord(row) : null;
}

/** Status mais recente pra persona (qualquer status), ou null. */
export function latestByPersona(
  db: Database.Database,
  personaId: string,
): Mc1ScheduledRecord | null {
  const row = db
    .prepare(
      `SELECT id, persona_id, approved_text, target_window_name,
              scheduled_at, status, delivered_at
         FROM mc1_scheduled
        WHERE persona_id = ?
        ORDER BY scheduled_at DESC
        LIMIT 1`,
    )
    .get(personaId) as Mc1Row | undefined;
  return row ? rowToRecord(row) : null;
}

export function markDelivered(
  db: Database.Database,
  id: number,
  deliveredAt?: string,
): boolean {
  const ts = deliveredAt ?? new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE mc1_scheduled
          SET status = 'delivered', delivered_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(ts, id);
  return result.changes > 0;
}

/** Cancela todas as MC1 pending da persona. Retorna quantidade afetada. */
export function cancelPendingByPersona(
  db: Database.Database,
  personaId: string,
): number {
  const result = db
    .prepare(
      `UPDATE mc1_scheduled
          SET status = 'cancelled'
        WHERE persona_id = ? AND status = 'pending'`,
    )
    .run(personaId);
  return result.changes;
}
