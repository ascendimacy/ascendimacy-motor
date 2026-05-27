/**
 * S1 wiring — Modelo do Aprendiz endpoints (declared objectives,
 * narrative threads, subject-knowledge aggregate).
 *
 * Spec parent: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 * Specs feature:
 *   - 2026-05-26-s1-objetivos-declarados-v0.md (PR #249)
 *   - 2026-05-26-b1-hooks-temporais-v0.md       (PR #243, threads compartilhadas)
 *   - 2026-05-25-subject-knowledge-bridge.md    (ledger por sujeito)
 *
 * Plugin separado pra não inflar `server.ts` (outros agentes paralelos
 * editando). DDL idempotente garante schema mesmo quando o motor-execucao
 * ainda não escreveu na sessão corrente.
 *
 * Query SQL inline porque motor-execucao ainda não exporta um entrypoint
 * de pacote — duplicação aceita: 1 SELECT por endpoint, projeção zod
 * via shared schemas.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  DeclaredObjectiveSchema,
  type DeclaredObjective,
  type NarrativeThread,
  type NarrativeThreadStatus,
} from "@ascendimacy/shared";

export interface S1RoutesOptions {
  db: DatabaseType;
}

const DDL = `
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
CREATE INDEX IF NOT EXISTS idx_declared_objectives_by_parent
  ON kids_declared_objectives(parent_objective_id);

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
CREATE INDEX IF NOT EXISTS idx_threads_by_persona
  ON kids_narrative_threads(persona_id);
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

/** "Latest in chain" = row cujo id não é parent_objective_id de nenhuma outra. */
function listLatestByPersona(
  db: DatabaseType,
  personaId: string,
): DeclaredObjective[] {
  const rows = db
    .prepare(
      `SELECT * FROM kids_declared_objectives
       WHERE persona_id = ?
         AND id NOT IN (
           SELECT parent_objective_id FROM kids_declared_objectives
           WHERE parent_objective_id IS NOT NULL
         )
       ORDER BY declared_at DESC`,
    )
    .all(personaId) as ObjectiveRow[];
  return rows.map(rowToObjective);
}

/** Trail completo do objetivo: ancestrais + ele próprio + sucessores. */
function getObjectiveTrail(
  db: DatabaseType,
  personaId: string,
  objectiveId: string,
): DeclaredObjective[] {
  const all = db
    .prepare(
      `SELECT * FROM kids_declared_objectives WHERE persona_id = ?`,
    )
    .all(personaId) as ObjectiveRow[];
  if (all.length === 0) return [];
  const byId = new Map(all.map((r) => [r.id, r]));
  const byParent = new Map<string, ObjectiveRow>();
  for (const r of all) {
    if (r.parent_objective_id !== null) byParent.set(r.parent_objective_id, r);
  }
  const seed = byId.get(objectiveId);
  if (!seed) return [];
  const chain: ObjectiveRow[] = [];
  let cur: ObjectiveRow | undefined = seed;
  while (cur && cur.parent_objective_id !== null) {
    const parent = byId.get(cur.parent_objective_id);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  chain.push(seed);
  cur = byParent.get(seed.id);
  while (cur) {
    chain.push(cur);
    cur = byParent.get(cur.id);
  }
  return chain.map(rowToObjective);
}

function listOpenThreadsByPersona(
  db: DatabaseType,
  personaId: string,
): NarrativeThread[] {
  const rows = db
    .prepare(
      `SELECT * FROM kids_narrative_threads
       WHERE persona_id = ?
       ORDER BY opened_at DESC
       LIMIT 50`,
    )
    .all(personaId) as ThreadRow[];
  return rows.map(rowToThread);
}

export interface SubjectKnowledgeSummary {
  conceptsPresentedCount: number;
  recallPositiveRate: number | null;
  recallTotal: number;
  topConcepts: TopConceptEntry[];
}

export interface TopConceptEntry {
  concept_id: string;
  lineage_anchor: string;
  presentedCount: number;
  lastSeenAt: string;
}

function summarizeSubjectKnowledge(
  db: DatabaseType,
  personaId: string,
): SubjectKnowledgeSummary {
  // subject_knowledge.subject_id == persona_id no contexto eBrota Kids.
  const presented = db
    .prepare(
      `SELECT json_extract(payload_json, '$.concept_id') AS concept_id,
              json_extract(payload_json, '$.lineage_anchor') AS lineage_anchor,
              COUNT(*) AS presented_count,
              MAX(created_at) AS last_seen_at
       FROM subject_knowledge
       WHERE subject_id = ? AND type = 'presented_concept'
       GROUP BY concept_id, lineage_anchor
       ORDER BY last_seen_at DESC
       LIMIT 5`,
    )
    .all(personaId) as Array<{
      concept_id: string | null;
      lineage_anchor: string | null;
      presented_count: number;
      last_seen_at: string;
    }>;

  const totalPresented = db
    .prepare(
      `SELECT COUNT(*) AS n FROM subject_knowledge
       WHERE subject_id = ? AND type = 'presented_concept'`,
    )
    .get(personaId) as { n: number };

  const recall = db
    .prepare(
      `SELECT
         SUM(CASE WHEN json_extract(payload_json, '$.result') = 'positive' THEN 1 ELSE 0 END) AS positive,
         COUNT(*) AS total
       FROM subject_knowledge
       WHERE subject_id = ? AND type = 'recall_check_attempt'`,
    )
    .get(personaId) as { positive: number | null; total: number };

  const recallTotal = recall.total ?? 0;
  const positiveCount = recall.positive ?? 0;
  const recallPositiveRate = recallTotal > 0 ? positiveCount / recallTotal : null;

  return {
    conceptsPresentedCount: totalPresented.n,
    recallPositiveRate,
    recallTotal,
    topConcepts: presented.map((r) => ({
      concept_id: r.concept_id ?? "?",
      lineage_anchor: r.lineage_anchor ?? "?",
      presentedCount: r.presented_count,
      lastSeenAt: r.last_seen_at,
    })),
  };
}

const s1Routes: FastifyPluginAsync<S1RoutesOptions> = async (fastify, opts) => {
  const { db } = opts;
  db.exec(DDL);

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/objectives",
    async (req) => ({
      objectives: listLatestByPersona(db, req.params.id),
    }),
  );

  fastify.get<{ Params: { id: string; objId: string } }>(
    "/personas/:id/objectives/:objId/history",
    async (req, reply) => {
      const trail = getObjectiveTrail(db, req.params.id, req.params.objId);
      if (trail.length === 0) {
        return reply
          .code(404)
          .send({ error: `objective ${req.params.objId} não encontrado` });
      }
      return { trail };
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/narrative-threads",
    async (req) => ({
      threads: listOpenThreadsByPersona(db, req.params.id),
    }),
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/subject-knowledge",
    async (req) => summarizeSubjectKnowledge(db, req.params.id),
  );
};

export default s1Routes;
