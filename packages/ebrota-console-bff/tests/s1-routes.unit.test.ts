/**
 * S1 routes — unit tests com SQLite :memory:.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-s1-objetivos-declarados-v0.md
 *       ascendimacy-ops/docs/specs/2026-05-26-b1-hooks-temporais-v0.md
 *
 * Cobre: 4 endpoints + empty state + history trail + agregação ledger.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import s1Routes from "../src/routes/s1-routes.js";
import type {
  DeclaredObjective,
  NarrativeThread,
} from "@ascendimacy/shared";

let app: FastifyInstance;
let db: DatabaseType;

beforeEach(async () => {
  db = initDb({ dbPath: ":memory:" });
  app = Fastify({ logger: false });
  await app.register(s1Routes, { db });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

const inject = async (url: string) => {
  const res = await app.inject({ method: "GET", url });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as unknown) : null,
  };
};

function insertObjective(row: {
  id: string;
  persona_id: string;
  declared_at: string;
  declared_in_session: string;
  target_date: string;
  statement: string;
  axis?: string;
  status: string;
  parent_objective_id?: string;
}): void {
  db.prepare(
    `INSERT INTO kids_declared_objectives
       (id, persona_id, declared_at, declared_in_session, target_date,
        statement, axis, status, parent_objective_id, evidence_event_ids,
        drift_check_due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    row.id,
    row.persona_id,
    row.declared_at,
    row.declared_in_session,
    row.target_date,
    row.statement,
    row.axis ?? null,
    row.status,
    row.parent_objective_id ?? null,
  );
}

function insertThread(row: {
  id: string;
  persona_id: string;
  opened_in_session: string;
  opened_at: string;
  thread_text: string;
  status: string;
  stale_after: string;
}): void {
  db.prepare(
    `INSERT INTO kids_narrative_threads
       (id, persona_id, opened_in_session, opened_at, thread_text, axis,
        follow_up_triggered, closed_at, status, stale_after)
     VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)`,
  ).run(
    row.id,
    row.persona_id,
    row.opened_in_session,
    row.opened_at,
    row.thread_text,
    row.status,
    row.stale_after,
  );
}

function insertSubjectKnowledge(row: {
  id: string;
  subject_id: string;
  type: string;
  source: string;
  confidence: number;
  payload: Record<string, unknown>;
  session_id?: string;
  created_at?: string;
}): void {
  db.prepare(
    `INSERT INTO subject_knowledge
       (id, subject_id, type, source, confidence, alignment, payload_json,
        turn_ref, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'unknown', ?, 't1', ?, ?)`,
  ).run(
    row.id,
    row.subject_id,
    row.type,
    row.source,
    row.confidence,
    JSON.stringify(row.payload),
    row.session_id ?? "sess-test",
    row.created_at ?? new Date().toISOString(),
  );
}

describe("GET /personas/:id/objectives", () => {
  it("retorna lista vazia quando persona sem objetivos", async () => {
    const res = await inject("/personas/ryo/objectives");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ objectives: [] });
  });

  it("retorna apenas latest-in-chain (revised não aparece)", async () => {
    insertObjective({
      id: "obj-1",
      persona_id: "ryo",
      declared_at: "2026-05-01T10:00:00Z",
      declared_in_session: "sess-A",
      target_date: "2026-06-01T10:00:00Z",
      statement: "Ler 5 livros sobre dinossauros",
      axis: "curiosidade",
      status: "active",
    });
    insertObjective({
      id: "obj-1-revised",
      persona_id: "ryo",
      declared_at: "2026-05-15T10:00:00Z",
      declared_in_session: "sess-B",
      target_date: "2026-07-01T10:00:00Z",
      statement: "Ler 3 livros sobre dinossauros",
      status: "active",
      parent_objective_id: "obj-1",
    });
    insertObjective({
      id: "obj-2",
      persona_id: "ryo",
      declared_at: "2026-05-20T10:00:00Z",
      declared_in_session: "sess-C",
      target_date: "2026-08-01T10:00:00Z",
      statement: "Aprender 10 dobraduras de origami",
      status: "active",
    });

    const res = await inject("/personas/ryo/objectives");
    expect(res.status).toBe(200);
    const objectives = (res.body as { objectives: DeclaredObjective[] }).objectives;
    expect(objectives.map((o) => o.id).sort()).toEqual(["obj-1-revised", "obj-2"]);
  });

  it("filtra por persona_id (não vaza outros)", async () => {
    insertObjective({
      id: "obj-ryo",
      persona_id: "ryo",
      declared_at: "2026-05-01T10:00:00Z",
      declared_in_session: "sess-A",
      target_date: "2026-06-01T10:00:00Z",
      statement: "Algo",
      status: "active",
    });
    insertObjective({
      id: "obj-saki",
      persona_id: "saki",
      declared_at: "2026-05-01T10:00:00Z",
      declared_in_session: "sess-B",
      target_date: "2026-06-01T10:00:00Z",
      statement: "Outro",
      status: "active",
    });

    const res = await inject("/personas/ryo/objectives");
    const objectives = (res.body as { objectives: DeclaredObjective[] }).objectives;
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.persona_id).toBe("ryo");
  });
});

describe("GET /personas/:id/objectives/:objId/history", () => {
  it("404 quando objective não existe", async () => {
    const res = await inject("/personas/ryo/objectives/missing/history");
    expect(res.status).toBe(404);
  });

  it("retorna trail completo (ancestrais + node + sucessores)", async () => {
    insertObjective({
      id: "o-v1",
      persona_id: "ryo",
      declared_at: "2026-05-01T10:00:00Z",
      declared_in_session: "sess-A",
      target_date: "2026-06-01T10:00:00Z",
      statement: "v1",
      status: "revised",
    });
    insertObjective({
      id: "o-v2",
      persona_id: "ryo",
      declared_at: "2026-05-10T10:00:00Z",
      declared_in_session: "sess-B",
      target_date: "2026-06-15T10:00:00Z",
      statement: "v2",
      status: "revised",
      parent_objective_id: "o-v1",
    });
    insertObjective({
      id: "o-v3",
      persona_id: "ryo",
      declared_at: "2026-05-20T10:00:00Z",
      declared_in_session: "sess-C",
      target_date: "2026-07-01T10:00:00Z",
      statement: "v3",
      status: "active",
      parent_objective_id: "o-v2",
    });

    const res = await inject("/personas/ryo/objectives/o-v2/history");
    expect(res.status).toBe(200);
    const trail = (res.body as { trail: DeclaredObjective[] }).trail;
    expect(trail.map((o) => o.id)).toEqual(["o-v1", "o-v2", "o-v3"]);
  });
});

describe("GET /personas/:id/narrative-threads", () => {
  it("retorna lista vazia para persona nova", async () => {
    const res = await inject("/personas/ryo/narrative-threads");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ threads: [] });
  });

  it("retorna threads ordenados por opened_at desc", async () => {
    insertThread({
      id: "t-old",
      persona_id: "ryo",
      opened_in_session: "sess-A",
      opened_at: "2026-05-01T10:00:00Z",
      thread_text: "queria ver como joaninha come",
      status: "open",
      stale_after: "2026-05-08T10:00:00Z",
    });
    insertThread({
      id: "t-new",
      persona_id: "ryo",
      opened_in_session: "sess-B",
      opened_at: "2026-05-20T10:00:00Z",
      thread_text: "vou tentar fazer origami de baleia",
      status: "open",
      stale_after: "2026-05-27T10:00:00Z",
    });

    const res = await inject("/personas/ryo/narrative-threads");
    const threads = (res.body as { threads: NarrativeThread[] }).threads;
    expect(threads.map((t) => t.id)).toEqual(["t-new", "t-old"]);
  });

  it("filtra por persona", async () => {
    insertThread({
      id: "t-saki",
      persona_id: "saki",
      opened_in_session: "sess-X",
      opened_at: "2026-05-01T10:00:00Z",
      thread_text: "qualquer",
      status: "open",
      stale_after: "2026-05-08T10:00:00Z",
    });

    const res = await inject("/personas/ryo/narrative-threads");
    expect((res.body as { threads: NarrativeThread[] }).threads).toEqual([]);
  });
});

describe("GET /personas/:id/subject-knowledge", () => {
  it("retorna empty summary quando ledger vazio", async () => {
    const res = await inject("/personas/ryo/subject-knowledge");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      conceptsPresentedCount: 0,
      recallPositiveRate: null,
      recallTotal: 0,
      topConcepts: [],
    });
  });

  it("agrega presented_concepts + calcula recall rate", async () => {
    insertSubjectKnowledge({
      id: "sk-1",
      subject_id: "ryo",
      type: "presented_concept",
      source: "motor_inferred",
      confidence: 1,
      payload: {
        kind: "presented_concept",
        concept_id: "estoica/dicotomia_controle",
        lineage_anchor: "estoica/dicotomia_controle",
        axis_id: 3,
        family: "carater",
        keywords: ["controle"],
        points: 1,
      },
      created_at: "2026-05-20T10:00:00Z",
    });
    insertSubjectKnowledge({
      id: "sk-2",
      subject_id: "ryo",
      type: "presented_concept",
      source: "motor_inferred",
      confidence: 1,
      payload: {
        kind: "presented_concept",
        concept_id: "estoica/dicotomia_controle",
        lineage_anchor: "estoica/dicotomia_controle",
        axis_id: 3,
        family: "carater",
        keywords: ["controle"],
        points: 1,
      },
      created_at: "2026-05-22T10:00:00Z",
    });
    insertSubjectKnowledge({
      id: "sk-3",
      subject_id: "ryo",
      type: "recall_check_attempt",
      source: "motor_inferred",
      confidence: 1,
      payload: {
        kind: "recall_check_attempt",
        concept_id_referenced: "estoica/dicotomia_controle",
        framing_used: "...",
        result: "positive",
        points_awarded: 5,
      },
    });
    insertSubjectKnowledge({
      id: "sk-4",
      subject_id: "ryo",
      type: "recall_check_attempt",
      source: "motor_inferred",
      confidence: 1,
      payload: {
        kind: "recall_check_attempt",
        concept_id_referenced: "estoica/dicotomia_controle",
        framing_used: "...",
        result: "negative",
        points_awarded: 0,
      },
    });

    const res = await inject("/personas/ryo/subject-knowledge");
    expect(res.status).toBe(200);
    const body = res.body as {
      conceptsPresentedCount: number;
      recallPositiveRate: number | null;
      recallTotal: number;
      topConcepts: Array<{ concept_id: string; presentedCount: number }>;
    };
    expect(body.conceptsPresentedCount).toBe(2);
    expect(body.recallTotal).toBe(2);
    expect(body.recallPositiveRate).toBeCloseTo(0.5);
    expect(body.topConcepts).toHaveLength(1);
    expect(body.topConcepts[0]!.concept_id).toBe("estoica/dicotomia_controle");
    expect(body.topConcepts[0]!.presentedCount).toBe(2);
  });

  it("limita topConcepts a 5", async () => {
    for (let i = 0; i < 8; i++) {
      insertSubjectKnowledge({
        id: `sk-c${i}`,
        subject_id: "ryo",
        type: "presented_concept",
        source: "motor_inferred",
        confidence: 1,
        payload: {
          kind: "presented_concept",
          concept_id: `concept-${i}`,
          lineage_anchor: `lin-${i}`,
          axis_id: i + 1,
          family: "carater",
          keywords: [],
          points: 1,
        },
        created_at: new Date(2026, 4, i + 1).toISOString(),
      });
    }
    const res = await inject("/personas/ryo/subject-knowledge");
    const body = res.body as { topConcepts: unknown[] };
    expect(body.topConcepts).toHaveLength(5);
  });
});
