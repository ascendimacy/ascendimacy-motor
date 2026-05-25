/**
 * Subject Knowledge Repository — queries do ledger cross-session.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-25-subject-knowledge-bridge.md §4.
 * Fase 2: read-only views agregadas pros endpoints REST.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import type {
  SubjectKnowledgeEntry,
  SubjectKnowledgeType,
} from "@ascendimacy/shared";

interface SkRow {
  id: string;
  subject_id: string;
  type: string;
  source: string;
  confidence: number;
  confirmed_at: string | null;
  alignment: string;
  payload_json: string;
  turn_ref: string;
  session_id: string;
  created_at: string;
}

function rowToEntry(row: SkRow): SubjectKnowledgeEntry {
  return {
    id: row.id,
    subject_id: row.subject_id,
    type: row.type as SubjectKnowledgeType,
    source: row.source as SubjectKnowledgeEntry["source"],
    confidence: row.confidence,
    confirmed_at: row.confirmed_at,
    alignment: row.alignment as SubjectKnowledgeEntry["alignment"],
    payload: JSON.parse(row.payload_json),
    turn_ref: row.turn_ref,
    session_id: row.session_id,
    created_at: row.created_at,
  };
}

export interface ListOptions {
  /** Limita ao tipo (default: todos). */
  type?: SubjectKnowledgeType;
  /** Filtra por session_id (útil pra debug). */
  sessionId?: string;
  /** Limite (default 200). */
  limit?: number;
}

/**
 * Lista discoveries (interest/value/need/discovery) de um sujeito,
 * ordenadas por created_at desc. Boundary_events e checks ficam de fora —
 * use listBoundaryEvents() pra esses.
 */
export function listSubjectDiscoveries(
  db: DatabaseType,
  subjectId: string,
  opts: ListOptions = {},
): SubjectKnowledgeEntry[] {
  const limit = opts.limit ?? 200;
  const types = opts.type
    ? [opts.type]
    : ["interest", "value", "need", "discovery"];
  const placeholders = types.map(() => "?").join(",");
  const params: unknown[] = [subjectId, ...types];
  let sql = `
    SELECT * FROM subject_knowledge
    WHERE subject_id = ? AND type IN (${placeholders})
  `;
  if (opts.sessionId) {
    sql += " AND session_id = ?";
    params.push(opts.sessionId);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as SkRow[];
  return rows.map(rowToEntry);
}

/**
 * Lista boundary_events de um sujeito. Inclui agregação simples por
 * topic_category (count) — insumo pro Console UI parental destacar
 * padrões recorrentes ("Ryo evitou tema X 3x esta semana").
 */
export function listBoundaryEvents(
  db: DatabaseType,
  subjectId: string,
  opts: ListOptions = {},
): SubjectKnowledgeEntry[] {
  const limit = opts.limit ?? 200;
  const params: unknown[] = [subjectId];
  let sql = `
    SELECT * FROM subject_knowledge
    WHERE subject_id = ? AND type = 'boundary_event'
  `;
  if (opts.sessionId) {
    sql += " AND session_id = ?";
    params.push(opts.sessionId);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as SkRow[];
  return rows.map(rowToEntry);
}

export interface BoundaryCategorySummary {
  topic_category: string;
  count: number;
  high_intensity_count: number;
  last_seen_at: string;
}

/**
 * Agregado por topic_category pros sinais clínicos. Quando count >= 3
 * num mesmo topic (ou high_intensity_count >= 1), Console deve destacar.
 */
export function summarizeBoundariesByCategory(
  db: DatabaseType,
  subjectId: string,
): BoundaryCategorySummary[] {
  const sql = `
    SELECT
      json_extract(payload_json, '$.topic_category') AS topic_category,
      COUNT(*) AS count,
      SUM(CASE WHEN json_extract(payload_json, '$.intensity') = 'high' THEN 1 ELSE 0 END) AS high_intensity_count,
      MAX(created_at) AS last_seen_at
    FROM subject_knowledge
    WHERE subject_id = ? AND type = 'boundary_event'
    GROUP BY topic_category
    ORDER BY count DESC, last_seen_at DESC
  `;
  const rows = db.prepare(sql).all(subjectId) as Array<{
    topic_category: string;
    count: number;
    high_intensity_count: number;
    last_seen_at: string;
  }>;
  return rows.map((r) => ({
    topic_category: r.topic_category ?? "indefinido",
    count: r.count,
    high_intensity_count: r.high_intensity_count,
    last_seen_at: r.last_seen_at,
  }));
}
