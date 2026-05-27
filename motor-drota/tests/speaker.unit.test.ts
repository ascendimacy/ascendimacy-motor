/**
 * Speaker unit tests — S4 split (spec 2026-05-26-s4-separacao-decide-gera).
 *
 * Coverage por jogada: happy path + fallback + sanitização defensiva.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ContentItem,
  GatewayChatCompletionInput,
  GatewayChatCompletionOutput,
  ScoredContentItem,
  TacticDecision,
  Jogada,
} from "@ascendimacy/shared";

const captured: { req?: GatewayChatCompletionInput; calls: number } = {
  calls: 0,
};
const queue: Array<GatewayChatCompletionOutput | Error> = [];

vi.mock("@ascendimacy/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ascendimacy/shared")>();
  return {
    ...actual,
    callGateway: async (req: GatewayChatCompletionInput) => {
      captured.req = req;
      captured.calls++;
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error("test setup error: queue empty");
      return next;
    },
  };
});

import { speak } from "../src/speaker.js";
import { STABLE_MATERIALIZER_PREFIX } from "../src/constrained-materializer.js";

const buildLlmResponse = (content: string): GatewayChatCompletionOutput => ({
  content,
  tokens: { in: 200, out: 60, reasoning: 0 },
  provider: "infomaniak",
  model: "moonshotai/Kimi-K2.5",
  latency_ms: 200,
  attempt_count: 1,
  was_fallback: false,
});

const stubItem = (id = "item-001"): ScoredContentItem => ({
  item: {
    id,
    type: "curiosity_hook",
    domain: "biology",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 7,
    verified: true,
    base_score: 7,
    fact: "Golfinhos têm nomes.",
    bridge: "Que som você teria?",
    quest: "Pensa num apelido.",
    sacrifice_type: "reflect",
  } as ContentItem,
  score: 8,
  reasons: [],
});

const decisionFor = (
  jogada: Jogada,
  overrides: Partial<TacticDecision> = {},
): TacticDecision => ({
  jogada,
  selected_item_id: "item-001",
  angle: "entrada natural.",
  constraints: {
    avoid: [],
    register: "neutro",
    max_length_chars: 280,
  },
  rationale: "test decision",
  fallback_jogada: "espelho",
  ...overrides,
});

const buildCtx = (
  jogada: Jogada,
  overrides: Record<string, unknown> = {},
) => ({
  decision: decisionFor(jogada),
  action: stubItem(),
  subjectNameForm: "Ryo",
  mood: 6,
  engagement: "medium" as const,
  turnCount: 2,
  budgetRemaining: 12,
  jurisdictionActive: "jp" as const,
  incomingMessage: "tô treinando tênis",
  ...overrides,
});

beforeEach(() => {
  captured.req = undefined;
  captured.calls = 0;
  queue.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────
// Por jogada: happy + fallback + sanitization
// ─────────────────────────────────────────────────────────────────────────

const JOGADAS: Jogada[] = [
  "bridge",
  "espelho",
  "canal",
  "diamante",
  "arena",
  "recovery",
];

describe.each(JOGADAS)("speak — jogada %s", (jogada) => {
  it("happy path: LLM válido → text limpo, fallback_triggered=false", async () => {
    queue.push(buildLlmResponse("Resposta natural."));
    const r = await speak(buildCtx(jogada));
    expect(r.text).toBe("Resposta natural.");
    expect(r.fallback_triggered).toBe(false);
    expect(r.retried_with_fallback).toBe(false);
    expect(captured.req?.step).toBe("drota");
    expect(captured.req?.cacheableSystemPrefix).toBe(STABLE_MATERIALIZER_PREFIX);
    expect(captured.req?.userMessage).toContain(`JOGADA: ${jogada.toUpperCase()}`);
  });

  it("fallback: LLM retorna FALLBACK + decision.fallback_jogada → retry", async () => {
    queue.push(buildLlmResponse("FALLBACK: Reconheço."));
    queue.push(buildLlmResponse("Resposta da segunda tentativa."));
    const r = await speak(buildCtx(jogada));
    expect(r.retried_with_fallback).toBe(true);
    expect(r.text).toBe("Resposta da segunda tentativa.");
    expect(captured.calls).toBe(2);
  });

  it("sanitização: output contém FORBIDDEN_WORDS → sanitization_applied=true", async () => {
    queue.push(buildLlmResponse("Vou usar o playbook agora."));
    const r = await speak(buildCtx(jogada));
    expect(r.sanitization_applied).toBe(true);
    expect(r.text).not.toContain("playbook");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge cases globais
// ─────────────────────────────────────────────────────────────────────────

describe("speak — edge cases", () => {
  it("LLM error sem fallback_jogada → texto fallback hardcoded", async () => {
    queue.push(new Error("gateway down"));
    const r = await speak(
      buildCtx("espelho", {
        decision: decisionFor("espelho", { fallback_jogada: undefined }),
      }),
    );
    expect(r.fallback_triggered).toBe(true);
    expect(r.text).toBe("Tô por aqui. Quando quiser me contar mais, conta.");
  });

  it("LLM error com fallback_jogada → retry; se retry também falha, text mantém o fallback do speak", async () => {
    queue.push(new Error("first fail"));
    queue.push(new Error("retry also fails"));
    const r = await speak(buildCtx("bridge"));
    expect(r.retried_with_fallback).toBe(true);
    expect(r.fallback_triggered).toBe(true);
  });

  it("FALLBACK em ambas chamadas → fallback_triggered=true e texto vem do FALLBACK extraído", async () => {
    queue.push(buildLlmResponse("FALLBACK: primeiro."));
    queue.push(buildLlmResponse("FALLBACK: segundo."));
    const r = await speak(buildCtx("arena"));
    expect(r.retried_with_fallback).toBe(true);
    expect(r.fallback_triggered).toBe(true);
    expect(r.text).toBe("segundo.");
  });

  it("decision.constraints.avoid não-vazio aparece no userMessage", async () => {
    queue.push(buildLlmResponse("ok"));
    const decision = decisionFor("bridge", {
      constraints: {
        avoid: ["sexualidade", "violência"],
        register: "neutro",
      },
    });
    await speak({ ...buildCtx("bridge"), decision });
    const userMsg = captured.req?.userMessage ?? "";
    expect(userMsg).toContain("AVOID");
    expect(userMsg).toContain("sexualidade");
  });

  it("decision.constraints.must_include aparece como ANCHOR", async () => {
    queue.push(buildLlmResponse("ok"));
    const decision = decisionFor("diamante", {
      constraints: {
        avoid: [],
        register: "neutro",
        must_include: "respiração",
      },
    });
    await speak({ ...buildCtx("diamante"), decision });
    expect(captured.req?.userMessage).toContain("ANCHOR");
    expect(captured.req?.userMessage).toContain("respiração");
  });

  it("STABLE_MATERIALIZER_PREFIX é o prefix cacheável (mesmo do materializer)", async () => {
    queue.push(buildLlmResponse("ok"));
    await speak(buildCtx("espelho"));
    expect(captured.req?.cacheableSystemPrefix).toBe(STABLE_MATERIALIZER_PREFIX);
    expect(captured.req?.systemPrompt).toBe("");
  });
});
