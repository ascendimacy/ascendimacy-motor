/**
 * Tests pra unified-assessor (motor-simplificacao-v1 Step 1).
 *
 * Mock pattern espelha mood-extractor.test.ts: vi.mock de
 * @ascendimacy/shared sobrescrevendo callGateway. Captura `req` em closure
 * pra assertions sobre payload.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
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

import { assess, assessByRules, MOOD_FALLBACK } from "../src/unified-assessor.js";

function buildLlmResponse(content: string): GatewayChatCompletionOutput {
  return {
    content,
    tokens: { in: 100, out: 50, reasoning: 0 },
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
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

// ─────────────────────────────────────────────────────────────────────────
// Rule-based pre-pass
// ─────────────────────────────────────────────────────────────────────────

describe("assessByRules — distress markers PT", () => {
  it.each(["tô mal", "estou triste", "que tédio", "tô cansado"])(
    "'%s' → mood 2 + distress_marker_high (high conf)",
    (text) => {
      const r = assessByRules({ message: text, recentTurns: [] });
      expect(r?.mood).toBe(2);
      expect(r?.mood_confidence).toBe("high");
      expect(r?.signals).toContain("distress_marker_high");
      expect(r?.engagement).toBe("disengaging");
    },
  );
});

describe("assessByRules — distress markers JA", () => {
  it.each(["疲れた", "嫌だ", "もういい", "つまらん"])(
    "'%s' → mood 2 + distress",
    (text) => {
      const r = assessByRules({ message: text, recentTurns: [] });
      expect(r?.mood).toBe(2);
    },
  );
});

describe("assessByRules — exit markers", () => {
  it("'tchau' → mood 3 + deflection_thematic (high conf)", () => {
    const r = assessByRules({ message: "tchau", recentTurns: [] });
    expect(r?.mood).toBe(3);
    expect(r?.signals).toContain("deflection_thematic");
    expect(r?.mood_confidence).toBe("high");
  });

  it("'preciso ir' → mood 3", () => {
    const r = assessByRules({ message: "preciso ir agora", recentTurns: [] });
    expect(r?.mood).toBe(3);
  });

  it("'さよなら' → mood 3 (JA exit)", () => {
    const r = assessByRules({ message: "さよなら", recentTurns: [] });
    expect(r?.mood).toBe(3);
  });
});

describe("assessByRules — entusiasmo + texto longo", () => {
  it("texto longo com '!!' → mood 8 (high conf)", () => {
    const text =
      "Hoje vi um documentário sobre golfinhos e foi MUITO incrível!! eles falam usando padrões diferentes!!";
    const r = assessByRules({ message: text, recentTurns: [] });
    expect(r?.mood).toBe(8);
    expect(r?.mood_confidence).toBe("high");
    expect(r?.engagement).toBe("high");
  });

  it("texto curto com entusiasmo NÃO triggera regra (length<50)", () => {
    const r = assessByRules({ message: "adorei!", recentTurns: [] });
    // Curto → não bate threshold; cai pra outro caso ou null
    expect(r?.mood).not.toBe(8);
  });
});

describe("assessByRules — monosyllabic curto", () => {
  it("'sim ok' → mood 4 + deflection_silence (medium conf)", () => {
    const r = assessByRules({ message: "sim ok", recentTurns: [] });
    expect(r?.mood).toBe(4);
    expect(r?.mood_confidence).toBe("medium");
    expect(r?.signals).toContain("deflection_silence");
  });

  it("'n sei' → mood 4", () => {
    const r = assessByRules({ message: "n sei", recentTurns: [] });
    expect(r?.mood).toBe(4);
  });
});

describe("assessByRules — mensagem vazia", () => {
  it("'' → mood neutro low confidence", () => {
    const r = assessByRules({ message: "", recentTurns: [] });
    expect(r?.mood).toBe(MOOD_FALLBACK);
    expect(r?.mood_confidence).toBe("low");
  });

  it("whitespace only também", () => {
    const r = assessByRules({ message: "   ", recentTurns: [] });
    expect(r?.mood).toBe(MOOD_FALLBACK);
  });
});

describe("assessByRules — ambíguo retorna null", () => {
  it("texto neutro de tamanho médio → null (LLM resolve)", () => {
    const r = assessByRules({
      message: "estou pensando em qual personagem do anime é mais forte",
      recentTurns: [],
    });
    expect(r).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LLM happy path
// ─────────────────────────────────────────────────────────────────────────

describe("assess — LLM happy path", () => {
  it("rule null + LLM válido → assessment_method='unified_haiku', mood_method='llm'", async () => {
    mockResponse = buildLlmResponse(
      `{"mood": 7, "mood_confidence": "high", "signals": ["voluntary_topic_deepening"], "engagement": "high", "rationale": "explora tópico voluntariamente"}`,
    );
    const r = await assess({
      message: "estou pensando em qual personagem do anime é mais forte e por quê",
      recentTurns: [],
    });
    expect(r.mood).toBe(7);
    expect(r.assessment_method).toBe("unified_haiku");
    expect(r.mood_method).toBe("llm");
    expect(r.signals).toContain("voluntary_topic_deepening");
    expect(r.engagement).toBe("high");
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("envia step='unified-assessor' + maxTokens=256 ao gateway", async () => {
    mockResponse = buildLlmResponse(
      `{"mood": 5, "mood_confidence": "medium", "signals": [], "engagement": "medium", "rationale": "neutro"}`,
    );
    await assess({
      message: "estou pensando em coisas",
      recentTurns: [],
    });
    expect(captured.req?.step).toBe("unified-assessor");
    expect(captured.req?.maxTokens).toBe(256);
  });

  it("inclui recentTurns no userMessage", async () => {
    mockResponse = buildLlmResponse(
      `{"mood": 6, "mood_confidence": "medium", "signals": [], "engagement": "medium", "rationale": "ok"}`,
    );
    await assess({
      message: "talvez",
      recentTurns: [
        { role: "assistant", content: "quer continuar?" },
        { role: "user", content: "hm" },
      ],
      personaName: "Ryo",
    });
    expect(captured.req?.userMessage).toContain("Ryo");
    expect(captured.req?.userMessage).toContain("quer continuar?");
  });

  it("clampa mood >10 vindo do LLM", async () => {
    mockResponse = buildLlmResponse(
      `{"mood": 15, "mood_confidence": "low", "signals": [], "engagement": "medium", "rationale": "fora range"}`,
    );
    const r = await assess({
      message: "blah blah blah que coisa interessante",
      recentTurns: [],
    });
    expect(r.mood).toBe(10);
  });

  it("filtra signals fora do vocabulário canônico", async () => {
    mockResponse = buildLlmResponse(
      `{"mood": 5, "mood_confidence": "medium", "signals": ["voluntary_topic_deepening", "alucinado_signal", "frame_synthesis"], "engagement": "medium", "rationale": "x"}`,
    );
    const r = await assess({
      message: "que coisa interessante mesmo",
      recentTurns: [],
    });
    expect(r.signals).toContain("voluntary_topic_deepening");
    expect(r.signals).toContain("frame_synthesis");
    expect(r.signals).not.toContain("alucinado_signal");
  });

  it("aceita JSON com markdown fences", async () => {
    mockResponse = buildLlmResponse(
      "```json\n{\"mood\": 7, \"mood_confidence\": \"high\", \"signals\": [], \"engagement\": \"medium\", \"rationale\": \"ok\"}\n```",
    );
    const r = await assess({
      message: "aqui vou compartilhar uma reflexão minha",
      recentTurns: [],
    });
    expect(r.mood).toBe(7);
    expect(r.assessment_method).toBe("unified_haiku");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LLM fallback paths
// ─────────────────────────────────────────────────────────────────────────

describe("assess — LLM falha + rule-based foi medium → usa rule-based", () => {
  it("LLM erro → fallback rule (medium conf preserva)", async () => {
    mockError = new Error("gateway timeout");
    const r = await assess({
      message: "sim ok", // monosyllabic medium-conf rule
      recentTurns: [],
    });
    expect(r.mood).toBe(4);
    expect(r.mood_method).toBe("rule");
    expect(r.assessment_method).toBe("rule_only");
    expect(r.rationale).toContain("LLM indisponível");
  });
});

describe("assess — LLM falha + rule null → fallback degradado", () => {
  it("LLM erro + texto ambíguo → mood neutro fallback", async () => {
    mockError = new Error("gateway timeout");
    const r = await assess({
      message: "estou pensando em qual personagem é mais forte e por quê",
      recentTurns: [],
    });
    expect(r.mood).toBe(MOOD_FALLBACK);
    expect(r.mood_method).toBe("fallback");
    expect(r.assessment_method).toBe("fallback");
  });

  it("LLM JSON inválido → fallback degradado", async () => {
    mockResponse = buildLlmResponse("não consegui responder em JSON");
    const r = await assess({
      message: "estou pensando em coisas que talvez sejam interessantes",
      recentTurns: [],
    });
    expect(r.mood).toBe(MOOD_FALLBACK);
    expect(r.assessment_method).toBe("fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Rule-only path (high conf evita LLM)
// ─────────────────────────────────────────────────────────────────────────

describe("assess — rule-based high conf NÃO chama LLM", () => {
  it("distress text → rule_only (sem chamar gateway)", async () => {
    mockResponse = buildLlmResponse(`{"mood":99}`); // não deve ser usado
    const r = await assess({
      message: "tô mal",
      recentTurns: [],
    });
    expect(r.mood).toBe(2); // do rule-based, não 99 do mock
    expect(r.assessment_method).toBe("rule_only");
    expect(r.mood_method).toBe("rule");
    expect(captured.req).toBeUndefined(); // gateway NÃO foi chamado
  });

  it("exit marker → rule_only", async () => {
    mockResponse = buildLlmResponse(`{"mood":99}`);
    const r = await assess({ message: "tchau", recentTurns: [] });
    expect(r.assessment_method).toBe("rule_only");
    expect(r.mood).toBe(3);
    expect(captured.req).toBeUndefined();
  });
});
