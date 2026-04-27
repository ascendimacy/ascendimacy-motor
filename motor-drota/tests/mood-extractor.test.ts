/**
 * Tests pra mood-extractor (motor#35 PART B).
 *
 * Mock pattern (espelha motor-drota/tests/llm-client.test.ts): vi.mock
 * de "@ascendimacy/shared" sobrescrevendo callGateway com versão sob
 * controle do test. Captura `req` em closure pra assertions sobre o
 * payload enviado ao gateway.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
} from "@ascendimacy/shared";

// Estado do mock — closures referenciadas pelo vi.mock factory.
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

import { extractMood, scoreByRules } from "../src/mood-extractor.js";

const FIXED_NOW = "2026-04-27T12:00:00Z";

function buildLlmResponse(content: string): GatewayChatCompletionOutput {
  return {
    content,
    tokens: { in: 100, out: 50, reasoning: 0 },
    provider: "infomaniak",
    model: "mistral3",
    latency_ms: 150,
    attempt_count: 1,
    was_fallback: false,
  };
}

beforeEach(() => {
  captured.req = undefined;
  mockResponse = null;
  mockError = null;
});

describe("extractMood — happy path LLM", () => {
  it("parsea JSON válido + retorna source='llm', fallback_used=false", async () => {
    mockResponse = buildLlmResponse(
      `{"score": 7, "rationale": "Tom animado, fala sobre Dragon Ball"}`,
    );
    const result = await extractMood(
      { userText: "ah, hoje vi o Goku indo SSJ4!" },
      { now: () => FIXED_NOW },
    );
    expect(result.score).toBe(7);
    expect(result.source).toBe("llm");
    expect(result.fallback_used).toBe(false);
    expect(result.at).toBe(FIXED_NOW);
    expect(result.rationale).toContain("Dragon Ball");
  });

  it("envia step='mood-extractor' + maxTokens=256 ao gateway", async () => {
    mockResponse = buildLlmResponse(`{"score": 5, "rationale": "neutro"}`);
    await extractMood({ userText: "sei lá" });
    expect(captured.req?.step).toBe("mood-extractor");
    expect(captured.req?.maxTokens).toBe(256);
  });

  it("inclui recentHistory no userMessage quando passado", async () => {
    mockResponse = buildLlmResponse(`{"score": 6, "rationale": "ok"}`);
    await extractMood({
      userText: "talvez",
      recentHistory: [
        { role: "assistant", content: "quer continuar?" },
        { role: "user", content: "hm" },
      ],
    });
    expect(captured.req?.userMessage).toContain("Context");
    expect(captured.req?.userMessage).toContain("quer continuar?");
  });

  it("clampa score >10 ou decimais via clampMoodScore", async () => {
    mockResponse = buildLlmResponse(
      `{"score": 12, "rationale": "fora do range"}`,
    );
    const result = await extractMood({ userText: "muito legal!" });
    expect(result.score).toBe(10); // clamp superior
    expect(result.source).toBe("llm");
  });

  it("aceita JSON com markdown fences (strip antes de parse)", async () => {
    mockResponse = buildLlmResponse(
      "```json\n{\"score\": 8, \"rationale\": \"animado\"}\n```",
    );
    const result = await extractMood({ userText: "uhul!" });
    expect(result.score).toBe(8);
    expect(result.source).toBe("llm");
  });
});

describe("extractMood — fallback rule-based", () => {
  it("LLM lança erro → fallback rule-based", async () => {
    mockError = new Error("gateway timeout");
    const result = await extractMood({ userText: "tô mal" });
    expect(result.source).toBe("rule_based");
    expect(result.fallback_used).toBe(true);
    expect(result.score).toBe(2); // distress marker PT
  });

  it("LLM retorna JSON inválido → fallback rule-based", async () => {
    mockResponse = buildLlmResponse("não consegui responder em JSON");
    const result = await extractMood({ userText: "tchau" });
    expect(result.source).toBe("rule_based");
    expect(result.score).toBe(2); // distress marker PT
  });

  it("LLM retorna JSON sem campo score → fallback", async () => {
    mockResponse = buildLlmResponse(`{"rationale": "esqueci o score"}`);
    const result = await extractMood({ userText: "tudo bem" });
    expect(result.source).toBe("rule_based");
  });

  it("LLM retorna score como string → fallback", async () => {
    mockResponse = buildLlmResponse(
      `{"score": "sete", "rationale": "string"}`,
    );
    const result = await extractMood({ userText: "valeu" });
    expect(result.source).toBe("rule_based");
  });
});

describe("scoreByRules — distress markers PT", () => {
  it.each([
    "tô mal",
    "estou mal",
    "não quero mais",
    "preciso ir",
    "tchau",
    "que tédio",
    "tô cansado",
  ])("'%s' → score 2 (distress marker)", (text) => {
    expect(scoreByRules(text).score).toBe(2);
  });
});

describe("scoreByRules — distress markers JA", () => {
  it.each([
    "疲れた",
    "つかれた",
    "嫌だ",
    "やだ",
    "もういい",
    "つまらん",
    "さよなら",
    "owari",
  ])("'%s' → score 2 (distress marker JA)", (text) => {
    expect(scoreByRules(text).score).toBe(2);
  });
});

describe("scoreByRules — engagement signals", () => {
  it("texto vazio → MOOD_DEFAULT", () => {
    expect(scoreByRules("").score).toBe(5);
    expect(scoreByRules("   ").score).toBe(5);
  });

  it("1 palavra curta ('ok') → 4 (low engagement)", () => {
    expect(scoreByRules("ok").score).toBe(4);
    expect(scoreByRules("sim").score).toBe(4);
  });

  it("várias palavras curtas em texto curto → 4", () => {
    expect(scoreByRules("eu n sei").score).toBe(4);
  });

  it("texto longo neutro → MOOD_DEFAULT", () => {
    expect(
      scoreByRules(
        "estou pensando em qual personagem do Dragon Ball é mais forte",
      ).score,
    ).toBe(5);
  });

  it("rationale contém marker descritivo", () => {
    expect(scoreByRules("tô mal").rationale).toMatch(/distress/);
    expect(scoreByRules("ok").rationale).toMatch(/monoss/);
    expect(scoreByRules("texto longo aqui").rationale).toMatch(/neutro/);
  });
});
