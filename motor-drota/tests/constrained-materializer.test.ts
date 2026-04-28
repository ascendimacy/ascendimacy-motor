import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
  ScoredContentItem,
  ContentItem,
} from "@ascendimacy/shared";

const captured: { req?: GatewayChatCompletionInput } = {};
let mockResponse: GatewayChatCompletionOutput | null = null;
let mockError: Error | null = null;

vi.mock("@ascendimacy/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@ascendimacy/shared")>();
  return {
    ...actual,
    callGateway: async (req: GatewayChatCompletionInput) => {
      captured.req = req;
      if (mockError) throw mockError;
      if (!mockResponse) {
        throw new Error("test setup error: mockResponse not set");
      }
      return mockResponse;
    },
  };
});

import { materialize } from "../src/constrained-materializer.js";
import type { MaterializerContext } from "../src/constrained-materializer.js";

const buildLlmResponse = (content: string): GatewayChatCompletionOutput => ({
  content,
  tokens: { in: 100, out: 50, reasoning: 0 },
  provider: "infomaniak",
  model: "moonshotai/Kimi-K2.5",
  latency_ms: 150,
  attempt_count: 1,
  was_fallback: false,
});

const stubItem = (id = "test-action"): ScoredContentItem => ({
  item: {
    id,
    type: "curiosity_hook",
    domain: "biology",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 7,
    verified: true,
    base_score: 7,
    fact: "Os golfinhos têm nomes próprios.",
    bridge: "Que som você teria como nome?",
    quest: "Pensa num apelido pra você.",
    sacrifice_type: "reflect",
    sacrifice_amount: 3,
  } as ContentItem,
  score: 8,
  reasons: [],
});

const stubCtx = (overrides: Partial<MaterializerContext> = {}): MaterializerContext => ({
  action: stubItem(),
  subjectNameForm: "Ryo",
  mood: 6,
  engagement: "medium",
  turnCount: 2,
  budgetRemaining: 12,
  jurisdictionActive: "jp",
  ...overrides,
});

beforeEach(() => {
  captured.req = undefined;
  mockResponse = null;
  mockError = null;
});

// ─────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────

describe("materialize — happy path", () => {
  it("LLM válido → text limpo, fallback_triggered=false", async () => {
    mockResponse = buildLlmResponse("Que som você teria como nome?");
    const r = await materialize(stubCtx());
    expect(r.text).toBe("Que som você teria como nome?");
    expect(r.fallback_triggered).toBe(false);
    expect(r.model_used).toContain("Kimi");
  });

  it("envia step='drota' por default", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx());
    expect(captured.req?.step).toBe("drota");
  });

  it("override de step funciona", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ llmStep: "persona-sim" }));
    expect(captured.req?.step).toBe("persona-sim");
  });

  it("system prompt inclui slots dinâmicos", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ subjectNameForm: "Kei", mood: 4 }));
    const sys = captured.req?.systemPrompt ?? "";
    expect(sys).toContain("Kei");
    expect(sys).toContain("Mood atual: 4/10");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FALLBACK: prefix handling
// ─────────────────────────────────────────────────────────────────────────

describe("materialize — FALLBACK: prefix", () => {
  it("LLM retorna 'FALLBACK: ...' → fallback_triggered=true e texto extraído", async () => {
    mockResponse = buildLlmResponse(
      "FALLBACK: Estou aqui. Conta quando quiser.",
    );
    const r = await materialize(stubCtx());
    expect(r.fallback_triggered).toBe(true);
    expect(r.text).toBe("Estou aqui. Conta quando quiser.");
  });

  it("FALLBACK com whitespace inicial", async () => {
    mockResponse = buildLlmResponse(
      "  FALLBACK: Texto seguro.  ",
    );
    const r = await materialize(stubCtx());
    expect(r.fallback_triggered).toBe(true);
    expect(r.text).toBe("Texto seguro.");
  });

  it("texto SEM prefix FALLBACK → fallback_triggered=false", async () => {
    mockResponse = buildLlmResponse(
      "Resposta normal sem fallback prefix.",
    );
    const r = await materialize(stubCtx());
    expect(r.fallback_triggered).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sanitização defensiva final (FORBIDDEN_WORDS)
// ─────────────────────────────────────────────────────────────────────────

describe("materialize — sanitização final", () => {
  it("FORBIDDEN_WORDS no output → sanitization_applied=true e palavras removidas", async () => {
    mockResponse = buildLlmResponse(
      "Vou usar o playbook pra você.",
    );
    const r = await materialize(stubCtx());
    expect(r.sanitization_applied).toBe(true);
    expect(r.text).not.toContain("playbook");
  });

  it("output limpo → sanitization_applied=false", async () => {
    mockResponse = buildLlmResponse("Texto normal sem termo proibido.");
    const r = await materialize(stubCtx());
    expect(r.sanitization_applied).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Mood baixo / engagement disengaging — guidance no prompt
// ─────────────────────────────────────────────────────────────────────────

describe("materialize — mood/engagement guidance no prompt", () => {
  it("mood ≤ 3 inclui guidance 'SEM perguntas abertas'", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ mood: 2 }));
    expect(captured.req?.systemPrompt).toContain("SEM perguntas abertas");
  });

  it("engagement disengaging inclui guidance '1 frase, tom leve'", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ engagement: "disengaging" }));
    expect(captured.req?.systemPrompt).toContain("1 frase, tom leve");
  });

  it("turn ≤ 3 → guidance comprimento curto", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ turnCount: 1 }));
    expect(captured.req?.systemPrompt).toContain("turn inicial");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LLM error → fallback hardcoded
// ─────────────────────────────────────────────────────────────────────────

describe("materialize — LLM error fallback", () => {
  it("erro do gateway → texto fallback hardcoded + model_used='fallback_hardcoded'", async () => {
    mockError = new Error("gateway timeout");
    const r = await materialize(stubCtx());
    expect(r.fallback_triggered).toBe(true);
    expect(r.model_used).toBe("fallback_hardcoded");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.text).not.toContain("playbook"); // forbidden words check
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Latência + token count
// ─────────────────────────────────────────────────────────────────────────

describe("materialize — metadata", () => {
  it("latency_ms registrado", async () => {
    mockResponse = buildLlmResponse("ok");
    const r = await materialize(stubCtx());
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("token_count vem do gateway tokens.out", async () => {
    mockResponse = buildLlmResponse("ok");
    const r = await materialize(stubCtx());
    expect(r.token_count).toBe(50); // do mock
  });
});
