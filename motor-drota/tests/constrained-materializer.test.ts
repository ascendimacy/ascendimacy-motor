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

  it("userMessage inclui slots dinâmicos (post-Step 8 refactor)", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ subjectNameForm: "Kei", mood: 4 }));
    // Step 8: campos dinâmicos vão pro userMessage (não systemPrompt) pra
    // preservar prefix caching no vLLM.
    const user = captured.req?.userMessage ?? "";
    expect(user).toContain("Kei");
    expect(user).toContain("MOOD: 4/10");
  });

  it("cacheableSystemPrefix é STABLE_MATERIALIZER_PREFIX (cache hit pro vLLM)", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx());
    const prefix = captured.req?.cacheableSystemPrefix ?? "";
    expect(prefix.length).toBeGreaterThan(100);
    expect(prefix).toContain("CONTRATO DE VOZ");
    expect(prefix).toContain("CONSTRAINTS DE SEGURANÇA");
    expect(prefix).toContain("REGRAS CONDICIONAIS");
  });

  it("systemPrompt vazio (tudo fixo está em cacheableSystemPrefix)", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx());
    expect(captured.req?.systemPrompt).toBe("");
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

describe("materialize — regras condicionais sempre no cacheableSystemPrefix", () => {
  // Step 8: regras condicionais ficam SEMPRE no prefix como texto fixo
  // ("Se mood ≤ 3 → ..."). Aplicação em runtime depende do mood/engajamento
  // que LLM lê no userMessage. Cache hit preservado.
  it("'SEM perguntas abertas' no prefix (regra mood ≤ 3 fixa)", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ mood: 2 }));
    expect(captured.req?.cacheableSystemPrefix).toContain("SEM perguntas abertas");
  });

  it("'1 frase, tom leve' no prefix (regra disengaging fixa)", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ engagement: "disengaging" }));
    expect(captured.req?.cacheableSystemPrefix).toContain("1 frase, tom leve");
  });

  it("'turn inicial' no prefix (regra turn ≤ 3 fixa)", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ turnCount: 1 }));
    expect(captured.req?.cacheableSystemPrefix).toContain("turn inicial");
  });

  it("MOOD value vai pro userMessage (LLM aplica regra fixa do prefix)", async () => {
    mockResponse = buildLlmResponse("ok");
    await materialize(stubCtx({ mood: 2, engagement: "disengaging", turnCount: 1 }));
    expect(captured.req?.userMessage).toContain("MOOD: 2");
    expect(captured.req?.userMessage).toContain("ENGAJAMENTO: disengaging");
    expect(captured.req?.userMessage).toContain("TURN: 1");
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
