import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import {
  upsertStrategyPlan,
  getStrategyPlan,
  listStrategyPlansBySubject,
} from "../src/strategy-plan-repo.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient, type MockDaemonClient } from "../src/daemon-client.js";
import type { Database as DatabaseType } from "better-sqlite3";
import type { StrategyPlan } from "@ascendimacy/shared";

let db: DatabaseType;
let server: BffServer;
let daemon: MockDaemonClient;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
});
afterEach(async () => {
  await server.close();
});

const makePlan = (sessionId: string, subjectId = "ryo"): StrategyPlan => ({
  session_id: sessionId,
  subject_id: subjectId,
  composed_at: new Date().toISOString(),
  target_demonstrations: [
    {
      framework: "valores_classicos",
      dimension: "axis_3",
      goal: "expose",
      rationale: "test",
    },
  ],
  playbook_composition: [
    {
      move_id: "propose_dilemma",
      phase: "challenge_execute",
      estimated_minutes: 10,
      success_signal: "x",
    },
  ],
  overall_success_criteria: "y",
  fallback_strategy: "z",
});

describe("strategy-plan-repo", () => {
  it("upsert + get retorna mesmo plan", () => {
    const plan = makePlan("sess-1");
    upsertStrategyPlan(db, plan);
    const got = getStrategyPlan(db, "sess-1");
    expect(got?.session_id).toBe("sess-1");
    expect(got?.target_demonstrations[0].dimension).toBe("axis_3");
    expect(got?.playbook_composition[0].move_id).toBe("propose_dilemma");
  });

  it("get retorna null se sessão não existe", () => {
    expect(getStrategyPlan(db, "missing")).toBeNull();
  });

  it("upsert atualiza plan existente (idempotente)", () => {
    upsertStrategyPlan(db, makePlan("sess-1"));
    const updated = {
      ...makePlan("sess-1"),
      overall_success_criteria: "atualizado",
    };
    upsertStrategyPlan(db, updated);
    const got = getStrategyPlan(db, "sess-1");
    expect(got?.overall_success_criteria).toBe("atualizado");
  });

  it("list ordena por composed_at desc", () => {
    const p1: StrategyPlan = { ...makePlan("s-1"), composed_at: "2026-05-20T00:00:00Z" };
    const p2: StrategyPlan = { ...makePlan("s-2"), composed_at: "2026-05-25T00:00:00Z" };
    upsertStrategyPlan(db, p1);
    upsertStrategyPlan(db, p2);
    const list = listStrategyPlansBySubject(db, "ryo");
    expect(list.map((p) => p.session_id)).toEqual(["s-2", "s-1"]);
  });
});

describe("endpoints REST", () => {
  const inject = async (url: string) => {
    const res = await server.fastify.inject({ method: "GET", url });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };

  it("GET /sessions/:id/strategy-plan 404 quando não existe", async () => {
    const r = await inject("/sessions/missing/strategy-plan");
    expect(r.status).toBe(404);
  });

  it("GET /sessions/:id/strategy-plan retorna plan persistido", async () => {
    upsertStrategyPlan(db, makePlan("sess-x"));
    const r = await inject("/sessions/sess-x/strategy-plan");
    expect(r.status).toBe(200);
    expect(r.body.plan.session_id).toBe("sess-x");
  });

  it("GET /subjects/:id/strategy-plans lista vazia retorna []", async () => {
    const r = await inject("/subjects/none/strategy-plans");
    expect(r.status).toBe(200);
    expect(r.body.plans).toEqual([]);
  });

  it("GET /subjects/:id/strategy-plans lista plans do sujeito", async () => {
    upsertStrategyPlan(db, makePlan("a"));
    upsertStrategyPlan(db, makePlan("b"));
    upsertStrategyPlan(db, makePlan("c", "kei"));
    const r = await inject("/subjects/ryo/strategy-plans");
    expect(r.body.plans).toHaveLength(2);
    expect(r.body.plans.every((p: StrategyPlan) => p.subject_id === "ryo")).toBe(true);
  });
});
