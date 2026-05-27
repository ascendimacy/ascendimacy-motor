/**
 * kids_narrative_threads — persistência de threads narrativos B1.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b1-hooks-temporais-v0.md §schema
 *
 * Threads representam o que ficou em aberto numa sessão. O scheduler
 * (orchestrator/src/temporal-scheduler.ts) usa listOpen() pra detectar
 * candidatas a hook quando janela temporal abre.
 *
 * markStale() é background job — chamado pelo scheduler tick. Threads
 * que passaram do stale_after são marcadas e param de ser candidatas.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { NarrativeThread, NarrativeThreadStatus } from "@ascendimacy/shared";

export const NARRATIVE_THREADS_DDL = `
CREATE TABLE IF NOT EXISTS kids_narrative_threads (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  opened_in_session TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  thread_text TEXT NOT NULL,
  axis TEXT,
  follow_up_triggered INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  status TEXT NOT NULL,
  stale_after TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_by_persona ON kids_narrative_threads(persona_id);
CREATE INDEX IF NOT EXISTS idx_threads_by_status ON kids_narrative_threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_by_stale_after ON kids_narrative_threads(stale_after);
`;

const DEFAULT_STALE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

interface ThreadRow {
  id: string;
  persona_id: string;
  opened_in_session: string;
  opened_at: string;
  thread_text: string;
  axis: string | null;
  follow_up_triggered: number;
  closed_at: string | null;
  status: string;
  stale_after: string;
}

function rowToThread(row: ThreadRow): NarrativeThread {
  const out: NarrativeThread = {
    id: row.id,
    persona_id: row.persona_id,
    opened_in_session: row.opened_in_session,
    opened_at: row.opened_at,
    thread_text: row.thread_text,
    follow_up_triggered: row.follow_up_triggered === 1,
    status: row.status as NarrativeThreadStatus,
    stale_after: row.stale_after,
  };
  if (row.axis !== null) out.axis = row.axis;
  if (row.closed_at !== null) out.closed_at = row.closed_at;
  return out;
}

function defaultStaleAfter(openedAt: string): string {
  const t = Date.parse(openedAt);
  return new Date(t + DEFAULT_STALE_DAYS * MS_PER_DAY).toISOString();
}

export interface OpenThreadInput {
  persona_id: string;
  opened_in_session: string;
  opened_at: string;
  thread_text: string;
  axis?: string;
  /** Override do default 7d após opened_at. */
  stale_after?: string;
}

export function openThread(
  db: Database.Database,
  input: OpenThreadInput,
): NarrativeThread {
  const thread: NarrativeThread = {
    id: randomUUID(),
    persona_id: input.persona_id,
    opened_in_session: input.opened_in_session,
    opened_at: input.opened_at,
    thread_text: input.thread_text,
    follow_up_triggered: false,
    status: "open",
    stale_after: input.stale_after ?? defaultStaleAfter(input.opened_at),
  };
  if (input.axis !== undefined) thread.axis = input.axis;
  db.prepare(
    `INSERT INTO kids_narrative_threads
       (id, persona_id, opened_in_session, opened_at, thread_text, axis,
        follow_up_triggered, closed_at, status, stale_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    thread.id,
    thread.persona_id,
    thread.opened_in_session,
    thread.opened_at,
    thread.thread_text,
    thread.axis ?? null,
    thread.follow_up_triggered ? 1 : 0,
    thread.status,
    thread.stale_after,
  );
  return thread;
}

export function getThread(
  db: Database.Database,
  id: string,
): NarrativeThread | null {
  const row = db
    .prepare(`SELECT * FROM kids_narrative_threads WHERE id = ?`)
    .get(id) as ThreadRow | undefined;
  return row ? rowToThread(row) : null;
}

/** Marca thread como retomado (status open|stale → resumed). */
export function resumeThread(
  db: Database.Database,
  id: string,
): NarrativeThread | null {
  const result = db
    .prepare(
      `UPDATE kids_narrative_threads
         SET status = 'resumed', follow_up_triggered = 1
       WHERE id = ? AND status IN ('open', 'stale')`,
    )
    .run(id);
  if (result.changes === 0) return null;
  return getThread(db, id);
}

/** Fecha thread (natural = aprendiz completou; abandoned = jamais retomou). */
export function closeThread(
  db: Database.Database,
  id: string,
  reason: "closed_natural" | "closed_abandoned",
  closedAt: string,
): NarrativeThread | null {
  const result = db
    .prepare(
      `UPDATE kids_narrative_threads
         SET status = ?, closed_at = ?
       WHERE id = ?`,
    )
    .run(reason, closedAt, id);
  if (result.changes === 0) return null;
  return getThread(db, id);
}

/** Threads ainda candidatas a hook (open ou resumed). */
export function listOpen(
  db: Database.Database,
  personaId: string,
): NarrativeThread[] {
  const rows = db
    .prepare(
      `SELECT * FROM kids_narrative_threads
         WHERE persona_id = ? AND status IN ('open', 'resumed')
       ORDER BY opened_at DESC`,
    )
    .all(personaId) as ThreadRow[];
  return rows.map(rowToThread);
}

/**
 * Background job: marca como stale toda thread open cujo stale_after já
 * passou (now > stale_after). Retorna número de threads marcadas.
 *
 * Param `thresholdDays` opcional: quando presente, sobrescreve stale_after
 * stored — útil pra force-stale em background sweep com política diferente.
 */
export function markStale(
  db: Database.Database,
  now: string,
  thresholdDays?: number,
): number {
  if (thresholdDays !== undefined) {
    const cutoff = new Date(
      Date.parse(now) - thresholdDays * MS_PER_DAY,
    ).toISOString();
    const result = db
      .prepare(
        `UPDATE kids_narrative_threads
           SET status = 'stale'
         WHERE status = 'open' AND opened_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  }
  const result = db
    .prepare(
      `UPDATE kids_narrative_threads
         SET status = 'stale'
       WHERE status = 'open' AND stale_after < ?`,
    )
    .run(now);
  return result.changes;
}
