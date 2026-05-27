/**
 * Tactician unit tests — S4 split (spec 2026-05-26-s4-separacao-decide-gera).
 *
 * Coverage:
 *   - 5 heurísticas rule-based + Haiku fallback path
 *   - Zod schema válido em cada jogada output
 *   - Sanitização do output do LLM (jogada fora do vocab → espelho)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ContentItem,
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
  ScoredContentItem,
} from "@ascendimacy/shared";
import { TacticDecisionSchema } from "@ascendimacy/shared";

const captured: { req?: GatewayChatCompletionInput } = {};
let mockResponse: GatewayChatCompletionOutput | null = null;
let mockError: Error | null = null;

vi.mock("@ascendimacy/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ascendimacy/shared")>();
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

import { tactician } from "../src/tactician.js";

const buildLlmResponse = (content: string): GatewayChatCompletionOutput => ({
  content,
  tokens: { in: 50, out: 60, reasoning: 0 },
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  latency_ms: 80,
  attempt_count: 1,
  was_fallback: false,
});

const stubCard = (id = "card-001"): ScoredContentItem => ({
  item: {
    id,
    type: "card_catalog",
    domain: "ethics",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 5,
    verified: true,
    base_score: 7,
    fact: "Um card de ética sobre temperança.",
  } as ContentItem,
  score: 8,
  reasons: [],
});

const stubCuriosity = (id = "hook-001"): ScoredContentItem => ({
  item: {
    id,
    type: "curiosity_hook",
    domain: "biology",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 7,
    verified: true,
    base_score: 6,
    fact: "Golfinhos têm nomes.",
    bridge: "Que som você teria?",
    quest: "Pensa num apelido.",
    sacrifice_type: "reflect",
  } as ContentItem,
  score: 7,
  reasons: [],
});

beforeEach(() => {
  captured.req = undefined;
  mockResponse = null;
  mockError = null;
});

// ─────────────────────────────────────────────────────────────────────────
// Heurísticas determinísticas — não chamam LLM
// ─────────────────────────────────────────────────────────────────────────

describe("tactician — heurística distress/mood", () => {
  it("signals contém distress → jogada=recovery, register=acolhedor", async () => {
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "",
      signals: ["distress_marker_high"],
      mood: 5,
    });
    expect(r.method).toBe("rule");
    expect(r.decision.jogada).toBe("recovery");
    expect(r.decision.constraints.register).toBe("acolhedor");
    expect(captured.req).toBeUndefined();
    expect(TacticDecisionSchema.safeParse(r.decision).success).toBe(true);
  });

  it("mood ≤ 2 → jogada=recovery (mesmo sem signal de distress)", async () => {
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "",
      signals: [],
      mood: 1,
    });
    expect(r.method).toBe("rule");
    expect(r.decision.jogada).toBe("recovery");
    expect(captured.req).toBeUndefined();
  });
});

describe("tactician — heurística question + card", () => {
  it("question_detected + card_catalog no head → jogada=bridge", async () => {
    const r = await tactician({
      contentPool: [stubCard(), stubCuriosity()],
      contextHints: {},
      strategicRationale: "",
      signals: ["question_detected"],
      mood: 6,
    });
    expect(r.method).toBe("rule");
    expect(r.decision.jogada).toBe("bridge");
    expect(r.decision.selected_item_id).toBe("card-001");
    expect(captured.req).toBeUndefined();
    expect(TacticDecisionSchema.safeParse(r.decision).success).toBe(true);
  });

  it("question_detected sem card no head → cai pra LLM (não bridge)", async () => {
    mockResponse = buildLlmResponse(
      JSON.stringify({
        jogada: "espelho",
        selected_item_id: "hook-001",
        angle: "reflete o que veio.",
        constraints: { avoid: [], register: "neutro" },
        rationale: "llm: pergunta sem card disponível, reflete primeiro.",
      }),
    );
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "",
      signals: ["question_detected"],
      mood: 6,
    });
    expect(r.method).toBe("llm");
    expect(captured.req?.step).toBe("unified-assessor");
  });
});

describe("tactician — heurística frame_synthesis", () => {
  it("frame_synthesis → jogada=diamante", async () => {
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "",
      signals: ["frame_synthesis"],
      mood: 7,
    });
    expect(r.method).toBe("rule");
    expect(r.decision.jogada).toBe("diamante");
    expect(captured.req).toBeUndefined();
    expect(TacticDecisionSchema.safeParse(r.decision).success).toBe(true);
  });
});

describe("tactician — heurística confronto/polemica", () => {
  it("strategicRationale com 'polêmica' → jogada=arena", async () => {
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "tema polêmico sobre regras de casa",
      signals: [],
      mood: 6,
    });
    expect(r.method).toBe("rule");
    expect(r.decision.jogada).toBe("arena");
    expect(captured.req).toBeUndefined();
  });

  it("strategicRationale com 'confronto' → jogada=arena", async () => {
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "vale criar confronto controlado aqui",
      signals: [],
      mood: 6,
    });
    expect(r.method).toBe("rule");
    expect(r.decision.jogada).toBe("arena");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LLM fallback (Haiku)
// ─────────────────────────────────────────────────────────────────────────

describe("tactician — fallback LLM (Haiku)", () => {
  it("nenhuma regra dispara + LLM JSON válido → method=llm e decision sanitizada", async () => {
    mockResponse = buildLlmResponse(
      JSON.stringify({
        jogada: "canal",
        selected_item_id: "hook-001",
        angle: "abre o canal latente sem pressionar.",
        constraints: { avoid: ["futebol"], register: "lúdico" },
        rationale: "llm: ele tangenciou tema; abrir canal.",
      }),
    );
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "neutro",
      signals: [],
      mood: 6,
    });
    expect(r.method).toBe("llm");
    expect(r.decision.jogada).toBe("canal");
    expect(r.decision.selected_item_id).toBe("hook-001");
    expect(r.decision.constraints.register).toBe("lúdico");
    expect(captured.req?.step).toBe("unified-assessor");
    expect(TacticDecisionSchema.safeParse(r.decision).success).toBe(true);
  });

  it("LLM retorna jogada fora do vocab → sanitiza pra espelho", async () => {
    mockResponse = buildLlmResponse(
      JSON.stringify({
        jogada: "ataque_supremo",
        selected_item_id: "hook-001",
        angle: "ataque.",
        constraints: { avoid: [], register: "firme" },
        rationale: "llm: alucinou jogada inexistente.",
      }),
    );
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "",
      signals: [],
      mood: 6,
    });
    expect(r.method).toBe("llm");
    expect(r.decision.jogada).toBe("espelho");
    expect(TacticDecisionSchema.safeParse(r.decision).success).toBe(true);
  });

  it("LLM retorna selected_item_id fora do pool → força head do pool", async () => {
    mockResponse = buildLlmResponse(
      JSON.stringify({
        jogada: "bridge",
        selected_item_id: "id-nao-existe",
        angle: "ponte.",
        constraints: { avoid: [], register: "neutro" },
        rationale: "llm: id alucinado.",
      }),
    );
    const r = await tactician({
      contentPool: [stubCuriosity("hook-001")],
      contextHints: {},
      strategicRationale: "",
      signals: [],
      mood: 6,
    });
    expect(r.decision.selected_item_id).toBe("hook-001");
  });

  it("LLM erro → fallback degradado method=fallback, ainda válido", async () => {
    mockError = new Error("haiku down");
    const r = await tactician({
      contentPool: [stubCuriosity()],
      contextHints: {},
      strategicRationale: "",
      signals: [],
      mood: 6,
    });
    expect(r.method).toBe("fallback");
    expect(TacticDecisionSchema.safeParse(r.decision).success).toBe(true);
    expect(r.decision.jogada).toBe("espelho");
  });

  it("LLM erro com card no pool → fallback escolhe bridge", async () => {
    mockError = new Error("haiku down");
    const r = await tactician({
      contentPool: [stubCard()],
      contextHints: {},
      strategicRationale: "",
      signals: [],
      mood: 6,
    });
    expect(r.method).toBe("fallback");
    expect(r.decision.jogada).toBe("bridge");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Zod schema cobertura — cada jogada deve passar
// ─────────────────────────────────────────────────────────────────────────

describe("tactician — todas as jogadas geram TacticDecision válida", () => {
  const cases: Array<{
    label: string;
    overrides: Record<string, unknown>;
  }> = [
    { label: "recovery", overrides: { signals: ["distress_marker_high"] } },
    {
      label: "bridge",
      overrides: { signals: ["question_detected"], pool: [stubCard()] },
    },
    { label: "diamante", overrides: { signals: ["frame_synthesis"] } },
    { label: "arena", overrides: { strategicRationale: "polêmica" } },
  ];
  for (const c of cases) {
    it(`jogada=${c.label} passa Zod`, async () => {
      const r = await tactician({
        contentPool: (c.overrides.pool as ScoredContentItem[]) ?? [
          stubCuriosity(),
        ],
        contextHints: {},
        strategicRationale:
          (c.overrides.strategicRationale as string) ?? "",
        signals: (c.overrides.signals as string[]) ?? [],
        mood: 6,
      });
      const parsed = TacticDecisionSchema.safeParse(r.decision);
      expect(parsed.success).toBe(true);
      expect(r.decision.angle.length).toBeLessThanOrEqual(80);
      expect(r.decision.rationale.length).toBeLessThanOrEqual(140);
    });
  }
});
