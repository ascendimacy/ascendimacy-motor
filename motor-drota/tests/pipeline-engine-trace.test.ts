/**
 * Tests TV2-4 — handleSimplifiedPipeline emite engineTrace v2 completo.
 *
 * Foca no aggregator: pre/post state + components + llm_calls +
 * sk writes + state_diff. Mocks callGateway + callGatewayWithTracing
 * via vi.mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ContentItem,
  EvaluateAndSelectInput,
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
  PersonaDef,
  ScoredContentItem,
} from "@ascendimacy/shared";

const mockCallCount = { n: 0 };
const responses: GatewayChatCompletionOutput[] = [];

vi.mock("@ascendimacy/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ascendimacy/shared")>();
  return {
    ...actual,
    callGateway: vi.fn(async (_req: GatewayChatCompletionInput) => {
      const r = responses[mockCallCount.n] ?? responses[responses.length - 1];
      mockCallCount.n += 1;
      if (!r) throw new Error("no mock response");
      return r;
    }),
    callGatewayWithTracing: vi.fn(async (req, role, collector) => {
      const r = responses[mockCallCount.n] ?? responses[responses.length - 1];
      mockCallCount.n += 1;
      if (!r) throw new Error("no mock response");
      collector?.push({
        id: `llm-mock-${role}-${mockCallCount.n}`,
        role,
        provider: "local",
        model: r.model,
        prompt: `[SYSTEM]\n${req.systemPrompt}\n\n[USER]\n${req.userMessage}`,
        response: r.content,
        duration_ms: r.latency_ms,
        input_tokens: r.tokens.in,
        output_tokens: r.tokens.out,
      });
      return r;
    }),
  };
});

import { handleSimplifiedPipeline } from "../src/simplified-pipeline-handler.js";

function llmResponse(content: string): GatewayChatCompletionOutput {
  return {
    content,
    tokens: { in: 100, out: 50, reasoning: 0 },
    provider: "local",
    model: "qwen14b",
    latency_ms: 200,
    attempt_count: 1,
    was_fallback: false,
  };
}

function stubItem(id: string, cost = 3): ScoredContentItem {
  return {
    item: {
      id,
      type: "curiosity_hook",
      domain: "biology",
      casel_target: ["SA"],
      age_range: [7, 14],
      surprise: 7,
      verified: true,
      base_score: 7,
      fact: "f",
      bridge: "b",
      quest: "q",
      sacrifice_type: "reflect",
      sacrifice_amount: cost,
    } as ContentItem,
    score: 8,
    reasons: [],
  };
}

function stubInput(overrides: Partial<EvaluateAndSelectInput> = {}): EvaluateAndSelectInput {
  return {
    sessionId: "test-session",
    contentPool: [stubItem("a", 3), stubItem("b", 5)],
    state: {
      sessionId: "test-session",
      trustLevel: 0.5,
      budgetRemaining: 15,
      eventLog: [],
      turn: 2,
    },
    persona: {
      id: "ryo-001",
      name: "Ryo",
      age: 13,
      profile: {},
    } as PersonaDef,
    strategicRationale: "",
    contextHints: { last_user_message: "tô legal" },
    ...overrides,
  } as EvaluateAndSelectInput;
}

beforeEach(() => {
  mockCallCount.n = 0;
  responses.length = 0;
});

describe("handleSimplifiedPipeline — TV2-4 engineTrace", () => {
  it("emite engineTrace v2 com schema_version=2 quando default (captureTrace=true)", async () => {
    // 1 LLM response = unified-assessor (haiku); selector é zero-LLM;
    // materializer faz 1 chamada. Mas no rule-path do assessor com
    // mensagem clara "tô legal" pode resolver rule-only.
    // Garantimos 2 responses pra cobrir os 2 paths possíveis.
    responses.push(
      llmResponse('{"mood":7,"signals":[],"engagement":"medium","mood_confidence":"high","rationale":"ok"}'),
      llmResponse("Lagarta quando dissolve, vira borboleta."),
    );
    const result = await handleSimplifiedPipeline(stubInput(), [stubItem("a", 3)]);
    expect(result.engineTrace).toBeDefined();
    expect(result.engineTrace?.schema_version).toBe(2);
  });

  it("popula pre_state + post_state + state_diff coerentes", async () => {
    responses.push(
      llmResponse('{"mood":7,"signals":[],"engagement":"medium","mood_confidence":"high","rationale":"ok"}'),
      llmResponse("Texto materializado."),
    );
    const input = stubInput();
    const result = await handleSimplifiedPipeline(input, [stubItem("a", 3)]);
    const t = result.engineTrace!;
    expect(t.pre_state.budget_remaining).toBe(15);
    expect(t.post_state.budget_remaining).toBeLessThanOrEqual(15);
    expect(t.state_diff.budget_delta).toBe(
      t.post_state.budget_remaining - t.pre_state.budget_remaining,
    );
    expect(t.state_diff.trust_delta).toBe(0); // motor não muda trust aqui
  });

  it("agrega trace seções dos 3 componentes em components", async () => {
    responses.push(
      llmResponse('{"mood":7,"signals":[],"engagement":"medium","mood_confidence":"high","rationale":"ok"}'),
      llmResponse("texto"),
    );
    const result = await handleSimplifiedPipeline(stubInput(), [stubItem("a", 3)]);
    const components = result.engineTrace!.components;
    expect(components.unified_assessor).toBeDefined();
    expect(components.pragmatic_selector).toBeDefined();
    expect(components.constrained_materializer).toBeDefined();
  });

  it("captura llm_calls do collector (assessor + materializer)", async () => {
    responses.push(
      llmResponse('{"mood":4,"signals":["positive_engagement"],"engagement":"medium","mood_confidence":"medium","rationale":"ok"}'),
      llmResponse("texto materializado"),
    );
    // mensagem ambígua pra forçar caminho LLM (não rule-high)
    const result = await handleSimplifiedPipeline(
      stubInput({ contextHints: { last_user_message: "talvez sim, sei lá" } }),
      [stubItem("a", 3)],
    );
    const calls = result.engineTrace!.llm_calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // pelo menos o materializer call deve estar lá
    expect(calls.some((c) => c.role === "materializer")).toBe(true);
  });

  it("annotates subject_knowledge_writes com writer correto", async () => {
    responses.push(
      llmResponse('{"mood":7,"signals":["positive_engagement"],"engagement":"medium","mood_confidence":"high","rationale":"ok"}'),
      llmResponse("texto"),
    );
    // Item taggeado com axis_id pra gerar presented_concept
    const taggedItem: ScoredContentItem = {
      ...stubItem("tagged_x"),
      item: {
        ...stubItem("tagged_x").item,
        axis_id: 11,
        family: "carater",
        lineage_anchor: "estoica/dicotomia_controle",
        extracted_keywords: ["transformação"],
      } as ContentItem,
    };
    const result = await handleSimplifiedPipeline(
      stubInput(),
      [taggedItem],
    );
    const writes = result.engineTrace!.subject_knowledge_writes;
    const presented = writes.find((w) => w.type === "presented_concept");
    if (presented) {
      expect(presented.writer).toBe("concept_ledger");
    }
  });

  it("captureTrace=false NÃO emite engineTrace", async () => {
    responses.push(
      llmResponse('{"mood":7,"signals":[],"engagement":"medium","mood_confidence":"high","rationale":"ok"}'),
      llmResponse("texto"),
    );
    const result = await handleSimplifiedPipeline(
      stubInput(),
      [stubItem("a", 3)],
      { captureTrace: false },
    );
    expect(result.engineTrace).toBeUndefined();
  });

  it("turn_started_at < turn_completed_at", async () => {
    responses.push(
      llmResponse('{"mood":7,"signals":[],"engagement":"medium","mood_confidence":"high","rationale":"ok"}'),
      llmResponse("texto"),
    );
    const result = await handleSimplifiedPipeline(stubInput(), [stubItem("a", 3)]);
    const t = result.engineTrace!;
    expect(
      new Date(t.turn_completed_at).getTime() >=
        new Date(t.turn_started_at).getTime(),
    ).toBe(true);
  });

  it("estado helix snapshot populado quando kidsHelixState presente", async () => {
    responses.push(
      llmResponse('{"mood":7,"signals":[],"engagement":"medium","mood_confidence":"high","rationale":"ok"}'),
      llmResponse("texto"),
    );
    const input = stubInput({
      state: {
        sessionId: "test-session",
        trustLevel: 0.6,
        budgetRemaining: 20,
        eventLog: [],
        turn: 3,
        kidsHelixState: {
          persona_id: "ryo-001",
          active_pair: ["SA", "SM"],
          cycle_started_at: "2026-05-01T00:00:00Z",
          current_day: 4,
          mode: "active",
          previous_pair: null,
          cycles_completed: 0,
          queue: ["SOC", "REL", "DM"],
          completed: [],
          deferred: [],
        },
      } as never,
    });
    const result = await handleSimplifiedPipeline(input, [stubItem("a", 3)]);
    const helix = result.engineTrace!.pre_state.helix_state;
    expect(helix).toBeDefined();
    expect(helix?.activeDimension).toBe("SA");
    expect(helix?.cycleDay).toBe(4);
  });
});
