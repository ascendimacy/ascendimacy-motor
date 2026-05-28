/**
 * S3 routes — unit tests com fixture filesystem.
 *
 * Spec: docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 *
 * Cobre: happy path, persona sem trace, limit param, agregação correta,
 * jogada vocab fixo (6 valores), traces dir env vazio, cache hit detection,
 * fallback rate, selector escalations, decision path split.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { resolve } from "node:path";
import s3Routes from "../src/routes/s3-routes.js";

const FIXTURES_DIR = resolve(__dirname, "fixtures");

async function buildApp(opts: { tracesDir?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(s3Routes, opts);
  await app.ready();
  return app;
}

let app: FastifyInstance;

afterEach(async () => {
  if (app) await app.close();
});

const inject = async (url: string) => {
  const res = await app.inject({ method: "GET", url });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as unknown) : null,
  };
};

describe("GET /personas/:id/decision-history", () => {
  beforeEach(async () => {
    app = await buildApp({ tracesDir: FIXTURES_DIR });
  });

  it("happy path: retorna 5 decisões da fixture ryo", async () => {
    const res = await inject("/personas/ryo/decision-history");
    expect(res.status).toBe(200);
    const body = res.body as { personaId: string; decisions: Array<unknown> };
    expect(body.personaId).toBe("ryo");
    expect(body.decisions).toHaveLength(5);
  });

  it("ordem desc por decidedAt (turn 5 vem primeiro)", async () => {
    const res = await inject("/personas/ryo/decision-history");
    const body = res.body as { decisions: Array<{ turnRef: string }> };
    expect(body.decisions[0]!.turnRef).toContain("turn_5");
    expect(body.decisions[4]!.turnRef).toContain("turn_1");
  });

  it("limit param respeitado", async () => {
    const res = await inject("/personas/ryo/decision-history?limit=2");
    const body = res.body as { decisions: unknown[] };
    expect(body.decisions).toHaveLength(2);
  });

  it("persona sem trace → array vazio", async () => {
    const res = await inject("/personas/inexistente/decision-history");
    const body = res.body as { decisions: unknown[] };
    expect(body.decisions).toEqual([]);
  });

  it("filtra por persona (saki não aparece em ryo)", async () => {
    const res = await inject("/personas/ryo/decision-history");
    const body = res.body as {
      decisions: Array<{ tacticDecision: { jogada: string } | null }>;
    };
    const jogadas = body.decisions
      .map((d) => d.tacticDecision?.jogada)
      .filter((j): j is string => j !== undefined);
    expect(jogadas).not.toContain("canal");
  });

  it("decisionPath: tactician_split quando tactic_decision presente", async () => {
    const res = await inject("/personas/ryo/decision-history");
    const body = res.body as {
      decisions: Array<{ decisionPath: string; tacticDecision: unknown | null }>;
    };
    const turn1 = body.decisions.find((d) => /turn_1$/.test(""));
    void turn1;
    const withTactic = body.decisions.filter((d) => d.tacticDecision !== null);
    expect(
      withTactic.every((d) => d.decisionPath === "tactician_split"),
    ).toBe(true);
    const withoutTactic = body.decisions.filter((d) => d.tacticDecision === null);
    expect(
      withoutTactic.every((d) => d.decisionPath === "pragmatic_selector_default"),
    ).toBe(true);
  });

  it("cacheHit detection via llm_calls[].prompt_cache_hit", async () => {
    const res = await inject("/personas/ryo/decision-history");
    const body = res.body as {
      decisions: Array<{ turnRef: string; cacheHit: boolean }>;
    };
    const turn1 = body.decisions.find((d) => d.turnRef.endsWith("turn_1"));
    expect(turn1?.cacheHit).toBe(true);
    const turn3 = body.decisions.find((d) => d.turnRef.endsWith("turn_3"));
    expect(turn3?.cacheHit).toBe(false);
  });

  it("skipReason detectado em warnings materializer", async () => {
    const res = await inject("/personas/ryo/decision-history");
    const body = res.body as {
      decisions: Array<{ turnRef: string; skipReason: string | null }>;
    };
    const turn5 = body.decisions.find((d) => d.turnRef.endsWith("turn_5"));
    expect(turn5?.skipReason).toBe("materializer_fallback");
    const turn1 = body.decisions.find((d) => d.turnRef.endsWith("turn_1"));
    expect(turn1?.skipReason).toBeNull();
  });

  it("topNScores limita a 5 e ordena desc", async () => {
    const res = await inject("/personas/ryo/decision-history");
    const body = res.body as {
      decisions: Array<{ turnRef: string; topNScores: number[] }>;
    };
    const turn1 = body.decisions.find((d) => d.turnRef.endsWith("turn_1"))!;
    expect(turn1.topNScores).toHaveLength(5);
    // strict desc order
    for (let i = 1; i < turn1.topNScores.length; i++) {
      expect(turn1.topNScores[i]).toBeLessThanOrEqual(turn1.topNScores[i - 1]!);
    }
    expect(turn1.topNScores[0]).toBeCloseTo(0.85);
  });
});

describe("GET /personas/:id/jogada-distribution", () => {
  beforeEach(async () => {
    app = await buildApp({ tracesDir: FIXTURES_DIR });
  });

  it("retorna 6 chaves jogada fixas mesmo com vocab parcial", async () => {
    const res = await inject("/personas/ryo/jogada-distribution");
    const body = res.body as {
      byJogada: Record<string, number>;
    };
    const keys = Object.keys(body.byJogada).sort();
    expect(keys).toEqual([
      "arena",
      "bridge",
      "canal",
      "diamante",
      "espelho",
      "recovery",
    ]);
  });

  it("agregação correta: ryo tem 2 bridge + 1 espelho + 1 recovery", async () => {
    const res = await inject("/personas/ryo/jogada-distribution");
    const body = res.body as {
      totalDecisions: number;
      byJogada: Record<string, number>;
    };
    expect(body.totalDecisions).toBe(4); // turn 4 não tem tactic_decision
    expect(body.byJogada["bridge"]).toBe(2);
    expect(body.byJogada["espelho"]).toBe(1);
    expect(body.byJogada["recovery"]).toBe(1);
    expect(body.byJogada["canal"]).toBe(0);
    expect(body.byJogada["arena"]).toBe(0);
    expect(body.byJogada["diamante"]).toBe(0);
  });

  it("byMethod: 2 rule + 1 llm + 1 fallback (ryo)", async () => {
    const res = await inject("/personas/ryo/jogada-distribution");
    const body = res.body as {
      byMethod: { rule: number; llm: number; fallback: number };
    };
    expect(body.byMethod).toEqual({ rule: 2, llm: 1, fallback: 1 });
  });

  it("byRegister inclui valores do trace", async () => {
    const res = await inject("/personas/ryo/jogada-distribution");
    const body = res.body as { byRegister: Record<string, number> };
    expect(body.byRegister["lúdico"]).toBe(2);
    expect(body.byRegister["neutro"]).toBe(1);
    expect(body.byRegister["acolhedor"]).toBe(1);
  });

  it("developmentStub=true quando totalDecisions=0", async () => {
    const res = await inject("/personas/inexistente/jogada-distribution");
    const body = res.body as { totalDecisions: number; developmentStub: boolean };
    expect(body.totalDecisions).toBe(0);
    expect(body.developmentStub).toBe(true);
  });
});

describe("GET /personas/:id/decision-stats", () => {
  beforeEach(async () => {
    app = await buildApp({ tracesDir: FIXTURES_DIR });
  });

  it("totalTurns=5 e métricas calculadas pra ryo", async () => {
    const res = await inject("/personas/ryo/decision-stats");
    const body = res.body as {
      totalTurns: number;
      cacheHitRate: number;
      fallbackRate: number;
      avgPoolSize: number;
      avgTopScore: number;
      selectorEscalations: number;
    };
    expect(body.totalTurns).toBe(5);
    expect(body.cacheHitRate).toBeCloseTo(0.2); // 1/5
    expect(body.fallbackRate).toBeCloseTo(0.2); // 1/5
    expect(body.avgPoolSize).toBeCloseTo((12 + 10 + 14 + 8 + 5) / 5);
    expect(body.avgTopScore).toBeCloseTo((0.85 + 0.78 + 0.91 + 0.7 + 0.6) / 5);
    expect(body.selectorEscalations).toBe(1); // turn 3 method=llm
  });

  it("persona sem trace → zeros", async () => {
    const res = await inject("/personas/inexistente/decision-stats");
    const body = res.body as { totalTurns: number; cacheHitRate: number };
    expect(body.totalTurns).toBe(0);
    expect(body.cacheHitRate).toBe(0);
  });
});

describe("env var EBROTA_BFF_TRACES_DIR vazio", () => {
  it("retorna empty results sem erro quando tracesDir não configurado", async () => {
    app = await buildApp({});
    const h = await inject("/personas/ryo/decision-history");
    expect(h.status).toBe(200);
    expect((h.body as { decisions: unknown[] }).decisions).toEqual([]);
    const d = await inject("/personas/ryo/jogada-distribution");
    expect(d.status).toBe(200);
    expect((d.body as { totalDecisions: number }).totalDecisions).toBe(0);
    const s = await inject("/personas/ryo/decision-stats");
    expect(s.status).toBe(200);
    expect((s.body as { totalTurns: number }).totalTurns).toBe(0);
  });
});
