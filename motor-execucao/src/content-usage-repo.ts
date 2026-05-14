/**
 * Content usage tracker — cross-session repo (ops#1067).
 *
 * Habilita decay temporal real no scorer (shared/scorer.ts:149-160 hoje
 * tem dead code — `last_used_at` sempre undefined). Plus observability
 * pra Jun debugar padrões de oferta de items por persona.
 *
 * Escopo reduzido pos-reframe Jun 2026-05-14:
 * - Só observability/decay, NÃO decisão automatizada
 * - Decisão de repetição é conversacional (ops#1068 — drota pergunta)
 *
 * Per-persona granularity (mesmo item pode ter histórico distinto pra
 * Ryo vs Kei). Chave composta (persona_id, content_id).
 *
 * Refs: ops#1067, shared/src/content-item.ts:88-92 (campos declarados),
 * shared/src/scorer.ts:149-160 (decay logic que vai funcionar).
 */

import type Database from "better-sqlite3";
import { getNow } from "./clock.js";

export const CONTENT_USAGE_DDL = `
CREATE TABLE IF NOT EXISTS content_usage (
  persona_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (persona_id, content_id)
);
CREATE INDEX IF NOT EXISTS idx_content_usage_persona ON content_usage(persona_id);
`;

/** Row shape — espelha schema SQL. */
export interface ContentUsageRow {
  persona_id: string;
  content_id: string;
  times_used: number;
  last_used_at: string; // ISO 8601
}

/**
 * UPSERT — incrementa times_used + atualiza last_used_at.
 * Idempotente em rolls múltiplos com mesmo input (cada call += 1).
 *
 * Aceita `nowIso` override pra testabilidade determinística.
 */
export function recordContentUsage(
  db: Database.Database,
  args: { personaId: string; contentId: string; nowIso?: string },
): ContentUsageRow {
  const { personaId, contentId } = args;
  const ts = getNow(args.nowIso);

  db.prepare(
    `INSERT INTO content_usage (persona_id, content_id, times_used, last_used_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(persona_id, content_id) DO UPDATE SET
       times_used = times_used + 1,
       last_used_at = excluded.last_used_at`,
  ).run(personaId, contentId, ts);

  const row = db
    .prepare(
      `SELECT persona_id, content_id, times_used, last_used_at
       FROM content_usage WHERE persona_id = ? AND content_id = ?`,
    )
    .get(personaId, contentId) as ContentUsageRow;
  return row;
}

/**
 * Lê usage de 1 item específico. Retorna null se nunca usado.
 */
export function getContentUsage(
  db: Database.Database,
  args: { personaId: string; contentId: string },
): ContentUsageRow | null {
  const row = db
    .prepare(
      `SELECT persona_id, content_id, times_used, last_used_at
       FROM content_usage WHERE persona_id = ? AND content_id = ?`,
    )
    .get(args.personaId, args.contentId);
  return (row as ContentUsageRow | undefined) ?? null;
}

/**
 * Lê todo o histórico de uma persona — pra hidratação do pool no
 * planejador (futuro). Retorna Map<content_id, ContentUsageRow>.
 */
export function getAllContentUsageByPersona(
  db: Database.Database,
  personaId: string,
): Map<string, ContentUsageRow> {
  const rows = db
    .prepare(
      `SELECT persona_id, content_id, times_used, last_used_at
       FROM content_usage WHERE persona_id = ?`,
    )
    .all(personaId) as ContentUsageRow[];
  const map = new Map<string, ContentUsageRow>();
  for (const r of rows) map.set(r.content_id, r);
  return map;
}

/**
 * Total usage records — debug/diagnose helper.
 */
export function countContentUsage(db: Database.Database): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM content_usage")
    .get() as { n: number };
  return row.n;
}
