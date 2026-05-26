/**
 * Tests TV2-3 — componentes retornam _trace quando collector passado.
 *
 * Cobre unified-assessor, pragmatic-selector, constrained-materializer.
 * Planejador tem suite própria (testes em planejador/tests/).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assess } from "../src/unified-assessor.js";
import { selectAction } from "../src/pragmatic-selector.js";
import { materialize } from "../src/constrained-materializer.js";
import { createLlmTraceCollector } from "@ascendimacy/shared";
import type {
  ScoredContentItem,
  SessionState,
  ContentItem,
} from "@ascendimacy/shared";

vi.mock("@ascendimacy/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ascendimacy/shared")>();
  return {
    ...actual,
    callGateway: vi.fn(async () => ({
      content: "mocked response",
      tokens: { in: 50, out: 10, reasoning: 0 },
      provider: "local" as const,
      model: "qwen14b",
      latency_ms: 500,
      attempt_count: 1,
      was_fallback: false,
    })),
    callGatewayWithTracing: vi.fn(async (_req, role, collector) => {
      // Simula wrapper real — push trace + retorna resposta
      const id = `llm-mock-${role}-${Date.now()}`;
      collector?.push({
        id,
        role,
        provider: "local",
        model: "qwen14b",
        prompt: "mock prompt",
        response: "mocked response",
        duration_ms: 500,
      });
      return {
        content: "mocked response",
        tokens: { in: 50, out: 10, reasoning: 0 },
        provider: "local" as const,
        model: "qwen14b",
        latency_ms: 500,
        attempt_count: 1,
        was_fallback: false,
      };
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("assess (unified-assessor) — TV2-3", () => {
  it("sem collector, NÃO emite _trace (backward compat)", async () => {
    const result = await assess({
      message: "tô feliz pra caralho",
      recentTurns: [],
    });
    expect(result._trace).toBeUndefined();
  });

  it("com collector, emite AssessorTrace (rule path)", async () => {
    const collector = createLlmTraceCollector();
    const result = await assess(
      { message: "tô bem feliz!", recentTurns: [] },
      { collector },
    );
    expect(result._trace).toBeDefined();
    expect(result._trace?.outputs.mood).toBe(result.mood);
    expect(result._trace?.outputs.signals).toEqual(result.signals);
    expect(["rule", "llm", "fallback"]).toContain(result._trace?.mood_method);
    expect(result._trace?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("com collector, captura user_message + history_window", async () => {
    const collector = createLlmTraceCollector();
    const result = await assess(
      {
        message: "como vai?",
        recentTurns: [
          { role: "user", content: "oi" },
          { role: "assistant", content: "olá" },
        ],
      },
      { collector },
    );
    expect(result._trace?.inputs.user_message).toBe("como vai?");
    expect(result._trace?.inputs.turn_history_window).toBe(2);
  });
});

describe("selectAction (pragmatic-selector) — TV2-3", () => {
  const makeItem = (
    id: string,
    sacrifice = 5,
    score = 10,
  ): ScoredContentItem => ({
    item: {
      id,
      type: "curiosity_hook",
      domain: "biologia",
      casel_target: ["SA"],
      age_range: [10, 15],
      surprise: 7,
      verified: true,
      base_score: 5,
      sacrifice_amount: sacrifice,
      fact: "f",
      bridge: "b",
      quest: "q",
      sacrifice_type: "reflect",
    } as ContentItem,
    score,
    reasons: ["base_score=5"],
  });

  const state: SessionState = {
    turn: 1,
    sessionId: "s1",
    userId: "u1",
    budgetRemaining: 100,
    statusMatrix: { honesty: [], integrity: [] },
    eventLog: [],
  } as never;

  const assessment = {
    mood: 7,
    mood_confidence: "high" as const,
    mood_method: "rule" as const,
    signals: [],
    engagement: "medium" as const,
    assessment_method: "rule_only" as const,
    rationale: "ok",
    latency_ms: 0,
  };

  it("sem captureTrace, NÃO emite _trace", () => {
    const result = selectAction({
      candidates: [makeItem("a")],
      assessment,
      state,
    });
    expect(result._trace).toBeUndefined();
  });

  it("com captureTrace, emite SelectorTrace básico", () => {
    const result = selectAction(
      {
        candidates: [makeItem("a"), makeItem("b", 8)],
        assessment,
        state,
      },
      { captureTrace: true },
    );
    expect(result._trace).toBeDefined();
    expect(result._trace?.inputs.pool_size).toBe(2);
    expect(result._trace?.inputs.mood).toBe(7);
    expect(result._trace?.outputs.selected_id).toBe(result.selected?.item.id);
    expect(result._trace?.outputs.pool_remaining).toContain("a");
  });

  it("mood baixo dispara mood_low_cap filter no trace", () => {
    const result = selectAction(
      {
        candidates: [makeItem("expensive", 10), makeItem("cheap", 2)],
        assessment: { ...assessment, mood: 2 },
        state,
      },
      { captureTrace: true },
    );
    const filter = result._trace?.filters_applied.find(
      (f) => f.name === "mood_low_cap",
    );
    expect(filter).toBeDefined();
    expect(filter?.items_removed).toContain("expensive");
    expect(filter?.items_removed).not.toContain("cheap");
  });

  it("pool vazio com trace ainda retorna estrutura válida", () => {
    const result = selectAction(
      { candidates: [], assessment, state },
      { captureTrace: true },
    );
    expect(result._trace).toBeDefined();
    expect(result._trace?.inputs.pool_size).toBe(0);
    expect(result._trace?.outputs.selected_id).toBe("");
  });
});

describe("materialize (constrained-materializer) — TV2-3", () => {
  const ctx = {
    action: {
      item: {
        id: "test_item",
        type: "curiosity_hook" as const,
        domain: "biologia",
        casel_target: ["SA" as const],
        age_range: [10, 15] as [number, number],
        surprise: 7,
        verified: true,
        base_score: 5,
        fact: "f",
        bridge: "b",
        quest: "q",
        sacrifice_type: "reflect" as const,
      },
      score: 10,
      reasons: [],
    },
    subjectNameForm: "Test",
    mood: 7,
    engagement: "medium" as const,
    turnCount: 1,
    budgetRemaining: 100,
    jurisdictionActive: "br" as const,
  };

  it("sem collector, NÃO emite _trace", async () => {
    const result = await materialize(ctx);
    expect(result._trace).toBeUndefined();
  });

  it("com collector, emite MaterializerTrace com stable_prefix_hash + llm_call_ref", async () => {
    const collector = createLlmTraceCollector();
    const result = await materialize(ctx, { collector });
    expect(result._trace).toBeDefined();
    expect(result._trace?.inputs.selected_item_id).toBe("test_item");
    expect(result._trace?.stable_prefix_hash).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(result._trace?.outputs.raw_response).toBe("mocked response");
    expect(result._trace?.outputs.final_text).toBeTruthy();
    expect(result._trace?.llm_call_ref).toMatch(/^llm-mock-materializer/);
  });

  it("hash do prefix é determinístico cross-runs", async () => {
    const collector1 = createLlmTraceCollector();
    const collector2 = createLlmTraceCollector();
    const r1 = await materialize(ctx, { collector: collector1 });
    const r2 = await materialize(ctx, { collector: collector2 });
    expect(r1._trace?.stable_prefix_hash).toBe(r2._trace?.stable_prefix_hash);
  });
});
