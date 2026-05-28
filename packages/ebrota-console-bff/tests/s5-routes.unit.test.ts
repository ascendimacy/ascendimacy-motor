/**
 * S5 routes unit tests — guardrail / recall / trigger / kpi / STS.
 *
 * Stubs vs real:
 *  - guardrail-history e recall-check-history são reais (consultam SK).
 *  - trigger-events é stub_v0 (TriggerEvaluator não persiste em SQL).
 *  - kpi-longitudinal é mix real/stub dependendo de dados.
 *  - sts/scenarios e sts/personas são listas hardcoded v0.
 *  - sts/runs é real (consulta `sessions` kind='sts').
 *  - sts/runs/start é stub v0 (não spawna; só reserva run_id).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";
import type { Database as DatabaseType } from "better-sqlite3";

let server: BffServer;
let db: DatabaseType;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
});

afterEach(async () => {
  await server.close();
});

const inject = async (url: string, method: "GET" | "POST" = "GET", body?: unknown) => {
  const res = await server.fastify.inject({
    method,
    url,
    ...(body !== undefined ? { payload: body } : {}),
  });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as unknown) : null,
  };
};

function insertSk(
  type: string,
  payload: Record<string, unknown>,
  overrides: { subject_id?: string; session_id?: string; created_at?: string } = {},
): void {
  db.prepare(
    `INSERT INTO subject_knowledge
     (id, subject_id, type, source, confidence, alignment, payload_json, turn_ref, session_id, created_at)
     VALUES (?, ?, ?, 'motor_inferred', 0.8, 'aligned', ?, 't-0', ?, ?)`,
  ).run(
    `sk-${Math.random().toString(36).slice(2, 10)}`,
    overrides.subject_id ?? "ryo",
    type,
    JSON.stringify(payload),
    overrides.session_id ?? "ryo__sess-A",
    overrides.created_at ?? new Date().toISOString(),
  );
}

function insertSession(
  sessionId: string,
  personaId: string,
  kind: "real" | "sts",
  startedAt: string,
): void {
  db.prepare(
    `INSERT INTO sessions
     (session_id, persona_id, conversation_id, kind, started_at, turn_count, has_overrides)
     VALUES (?, ?, 'conv-1', ?, ?, 5, 0)`,
  ).run(sessionId, personaId, kind, startedAt);
}

describe("GET /personas/:id/guardrail-history", () => {
  it("retorna stub_v0 com lista vazia quando sem boundary_events", async () => {
    const res = await inject("/personas/ryo/guardrail-history");
    expect(res.status).toBe(200);
    const body = res.body as {
      checks: unknown[];
      passed_count: number;
      failed_count: number;
      source: string;
    };
    expect(body.checks).toEqual([]);
    expect(body.passed_count).toBe(0);
    expect(body.failed_count).toBe(0);
    expect(body.source).toBe("stub_v0");
  });

  it("retorna entries reais quando boundary_events existem", async () => {
    insertSk("boundary_event", {
      topic_category: "bullying_pt",
      label: "termo agressivo",
      intensity: 0.2,
      passed: true,
    });
    insertSk("boundary_event", {
      topic_category: "scaffold_guard",
      label: "scaffold falhou",
      intensity: 0.7,
      passed: false,
    });
    const res = await inject("/personas/ryo/guardrail-history?limit=10");
    expect(res.status).toBe(200);
    const body = res.body as {
      checks: Array<{ topic_category: string; passed: boolean }>;
      passed_count: number;
      failed_count: number;
      source: string;
    };
    expect(body.checks.length).toBe(2);
    expect(body.passed_count).toBe(1);
    expect(body.failed_count).toBe(1);
    expect(body.source).toBe("real");
  });
});

describe("GET /personas/:id/recall-check-history", () => {
  it("retorna stub_v0 quando vazio", async () => {
    const res = await inject("/personas/ryo/recall-check-history");
    expect(res.status).toBe(200);
    const body = res.body as { events: unknown[]; source: string };
    expect(body.events).toEqual([]);
    expect(body.source).toBe("stub_v0");
  });

  it("retorna events com outcome positive/negative", async () => {
    insertSk("recall_check_attempt", {
      concept_id: "dicotomia_controle",
      lineage_anchor: "estoica/dicotomia_controle",
      outcome: "positive",
      intensity: 0.9,
    });
    insertSk("recall_check_attempt", {
      concept_id: "amizade",
      lineage_anchor: "aristoteles/amizade",
      outcome: "negative",
      intensity: 0.3,
    });
    const res = await inject("/personas/ryo/recall-check-history?limit=5");
    const body = res.body as {
      events: Array<{ concept_id: string; outcome: string }>;
      source: string;
    };
    expect(body.events.length).toBe(2);
    expect(body.source).toBe("real");
    const outcomes = body.events.map((e) => e.outcome).sort();
    expect(outcomes).toEqual(["negative", "positive"]);
  });
});

describe("GET /personas/:id/trigger-events", () => {
  it("retorna sempre stub_v0 (não persistido em SQL ainda)", async () => {
    const res = await inject("/personas/ryo/trigger-events");
    expect(res.status).toBe(200);
    const body = res.body as { events: unknown[]; transitions: unknown[]; source: string };
    expect(body.events).toEqual([]);
    expect(body.transitions).toEqual([]);
    expect(body.source).toBe("stub_v0");
  });
});

describe("GET /personas/:id/kpi-longitudinal", () => {
  it("retorna source=stub_v0 quando persona sem dados", async () => {
    const res = await inject("/personas/ryo/kpi-longitudinal");
    expect(res.status).toBe(200);
    const body = res.body as {
      persona_id: string;
      mood_trajectory: unknown[];
      casel_deltas: unknown[];
      concept_retention: { total_attempts: number; positive_rate: number | null };
      recall_summary: { items_checked: number; positive_rate: number | null };
      source: string;
    };
    expect(body.persona_id).toBe("ryo");
    expect(body.mood_trajectory).toEqual([]);
    expect(body.casel_deltas).toEqual([]);
    expect(body.concept_retention.total_attempts).toBe(0);
    expect(body.recall_summary.items_checked).toBe(0);
    expect(body.source).toBe("stub_v0");
  });

  it("retorna partial_stub_v0 + mood_trajectory quando há sessões", async () => {
    insertSession("ryo__s1", "ryo", "real", "2026-05-20T10:00:00Z");
    insertSession("ryo__s2", "ryo", "sts", "2026-05-22T11:00:00Z");
    insertSk("recall_check_attempt", { concept_id: "x", outcome: "positive" });
    const res = await inject("/personas/ryo/kpi-longitudinal");
    const body = res.body as {
      mood_trajectory: Array<{ session_id: string }>;
      concept_retention: { total_attempts: number; positive_rate: number | null };
      source: string;
    };
    expect(body.mood_trajectory.length).toBe(2);
    expect(body.concept_retention.total_attempts).toBe(1);
    expect(body.concept_retention.positive_rate).toBe(1);
    expect(body.source).toBe("partial_stub_v0");
  });
});

describe("GET /sts/scenarios", () => {
  it("retorna lista hardcoded v0 com ≥3 scenarios", async () => {
    const res = await inject("/sts/scenarios");
    expect(res.status).toBe(200);
    const body = res.body as { scenarios: Array<{ id: string; label: string }> };
    expect(body.scenarios.length).toBeGreaterThanOrEqual(3);
    const ids = body.scenarios.map((s) => s.id);
    expect(ids).toContain("smoke-3d");
    expect(ids).toContain("nagareyama-30d");
  });
});

describe("GET /sts/personas", () => {
  it("retorna personas STS conhecidas (Paula, Ryo, Kei, Saki, paula-30d)", async () => {
    const res = await inject("/sts/personas");
    expect(res.status).toBe(200);
    const body = res.body as { personas: Array<{ id: string }> };
    const ids = body.personas.map((p) => p.id);
    expect(ids).toContain("paula-mendes");
    expect(ids).toContain("ryo-ochiai");
    expect(ids).toContain("kei-ochiai");
    expect(ids).toContain("saki-ochiai");
    expect(ids).toContain("paula-30d");
  });
});

// /sts/runs e /sts/runs/start agora bate na nova tabela `sts_runs` + spawn
// real. Os contratos GET vazio / validation são cobertos aqui; spawn end-
// to-end vive em `sts-spawn.integration.test.ts`.

describe("GET /sts/runs", () => {
  it("retorna lista vazia quando sts_runs vazio", async () => {
    const res = await inject("/sts/runs");
    expect(res.status).toBe(200);
    const body = res.body as { runs: unknown[] };
    expect(body.runs).toEqual([]);
  });
});

describe("POST /sts/runs/start (validation)", () => {
  it("400 quando persona_id desconhecida", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "fulano-inexistente",
      scenario_id: "smoke-3d",
    });
    expect(res.status).toBe(400);
  });

  it("400 quando scenario_id desconhecido", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      scenario_id: "cenario-inventado",
    });
    expect(res.status).toBe(400);
  });

  it("400 quando body sem campos obrigatórios", async () => {
    const res = await inject("/sts/runs/start", "POST", {});
    expect(res.status).toBe(400);
  });
});
