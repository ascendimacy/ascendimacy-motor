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

/**
 * G-22 Gap 2 hydration helper (ops#1033) — projeta usage per-persona em
 * Record<content_id, times_used>, filtrando por janela temporal (14 dias canon).
 *
 * Usado por state-manager.getState pra hidratar SessionState.recentContentUsage.
 * Planejador então consome em `computeChallengeCost.recentUsageCount` por item.
 *
 * Filtra rows com `last_used_at` dentro de [now - windowDays, now].
 * Sem usage → record vazio (não null), pra simplificar callers.
 *
 * @param windowDays — janela em dias; default 14 (canon G-22).
 * @param nowIso     — override pra testabilidade determinística.
 */
export function getRecentContentUsageRecord(
  db: Database.Database,
  personaId: string,
  windowDays = 14,
  nowIso?: string,
): Record<string, number> {
  const now = getNow(nowIso);
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    // Defensive — se nowIso malformado, retorna vazio sem throw
    return {};
  }
  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();

  const rows = db
    .prepare(
      `SELECT content_id, times_used
       FROM content_usage
       WHERE persona_id = ? AND last_used_at >= ?`,
    )
    .all(personaId, windowStartIso) as Array<{ content_id: string; times_used: number }>;

  const record: Record<string, number> = {};
  for (const r of rows) record[r.content_id] = r.times_used;
  return record;
}
