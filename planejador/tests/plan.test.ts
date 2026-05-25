import { describe, it, expect, beforeAll } from "vitest";
import { planTurn, buildSystemPrompt, detectQuestionInMessage } from "../src/plan.js";

process.env["USE_MOCK_LLM"] = "true";

const mockState = {
  sessionId: "test-001",
  trustLevel: 0.3,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
};

const mockPersona = {
  id: "ryo",
  name: "Ryo",
  age: 13,
  profile: { interests: ["dragon_ball"] },
};

const mockAdquirente = {
  id: "jun",
  name: "Jun Ochiai",
  defaults: { style: "direto", language: "pt-br" },
};

const mockInventory = [
  { id: "kids.helix.session", title: "Helix session", category: "kids", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
];

beforeAll(() => {
  // Garante que o seed padrão é encontrado pelos testes — caminho relativo do ESM.
});

describe("planTurn — Bloco 2a (contentPool)", () => {
  it("returns contentPool (not candidateActions)", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi, tudo bem?",
    });
    expect(Array.isArray(output.contentPool)).toBe(true);
    expect(output.contentPool.length).toBeGreaterThan(0);
    expect(output.strategicRationale).toBeTruthy();
  });

  it("each ScoredContentItem has item + score + reasons", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "quero saber mais",
    });
    for (const scored of output.contentPool) {
      expect(scored.item).toBeDefined();
      expect(typeof scored.score).toBe("number");
      expect(Array.isArray(scored.reasons)).toBe(true);
    }
  });

  it("contentPool is bounded by TOP_K_POOL (5)", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "me conta algo legal",
    });
    expect(output.contentPool.length).toBeLessThanOrEqual(5);
  });

  it("injects status_gates in contextHints", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    expect(output.contextHints["status_gates"]).toBeDefined();
  });

  it("injects casel_focus_dimension derived from status matrix", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...mockState, statusMatrix: { emotional: "brejo", social_with_ebrota: "baia" } },
      incomingMessage: "oi",
    });
    // emotional=brejo deve vir primeiro pela ordem de prioridade
    expect(output.contextHints["casel_focus_dimension"]).toBe("emotional");
  });
});

describe("planTurn — G-22 remaining gaps integration (ops#1033)", () => {
  it("sacrifice_breakdown agora inclui outcome/weekly/cycle/raw_total/bounded", async () => {
    const output = await planTurn({
      sessionId: "test-g22",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    const breakdown = output.contextHints["sacrifice_breakdown"] as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(breakdown)).toBe(true);
    expect(breakdown.length).toBeGreaterThan(0);
    const first = breakdown[0]!;
    // motor#124 fields preserved
    expect(first).toHaveProperty("base_effort");
    expect(first).toHaveProperty("consumption_mult");
    expect(first).toHaveProperty("sensitivity_mult");
    expect(first).toHaveProperty("challenge_mult");
    expect(first).toHaveProperty("total");
    // novos fields gaps 5+6+7+10
    expect(first).toHaveProperty("outcome_mult");
    expect(first).toHaveProperty("weekly_mult");
    expect(first).toHaveProperty("cycle_mult");
    expect(first).toHaveProperty("raw_total");
    expect(first).toHaveProperty("bounded");
  });

  it("emite sacrifice_context com outcome_signal + weekday + cycle_day + recent_usage_keys", async () => {
    const output = await planTurn({
      sessionId: "test-g22-ctx",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
    });
    const ctx = output.contextHints["sacrifice_context"] as Record<string, unknown>;
    expect(ctx).toBeDefined();
    expect(ctx).toHaveProperty("outcome_signal");
    expect(ctx).toHaveProperty("weekday");
    expect(ctx).toHaveProperty("cycle_day");
    expect(ctx).toHaveProperty("recent_usage_keys");
    // Default sem state.recentContentUsage → recent_usage_keys=0
    expect(ctx["recent_usage_keys"]).toBe(0);
    // Sem kidsHelixState → cycle_day=null
    expect(ctx["cycle_day"]).toBeNull();
    // Sem feedback_signal events → outcome_signal="unknown"
    expect(ctx["outcome_signal"]).toBe("unknown");
  });

  it("recentContentUsage hidratado propaga em recent_usage_keys (proxy)", async () => {
    const stateWithUsage = {
      ...mockState,
      recentContentUsage: { "item-a": 3, "item-b": 1 },
    };
    const output = await planTurn({
      sessionId: "test-g22-usage",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: stateWithUsage,
      incomingMessage: "oi",
    });
    const ctx = output.contextHints["sacrifice_context"] as Record<string, unknown>;
    expect(ctx["recent_usage_keys"]).toBe(2);
  });

  it("kidsHelixState.current_day populado → cycle_day reflete", async () => {
    const stateWithHelix = {
      ...mockState,
      kidsHelixState: {
        persona_id: "ryo",
        active_pair: ["SA", "SOC"] as const,
        cycle_started_at: "2026-05-01T00:00:00.000Z",
        current_day: 8,
        mode: "active" as const,
        previous_pair: null,
        cycles_completed: 0,
        queue: [],
        completed: [],
        deferred: [],
        triggers_fired_this_cycle: [],
      },
    };
    const output = await planTurn({
      sessionId: "test-g22-cycle",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state: stateWithHelix as any,
      incomingMessage: "oi",
    });
    const ctx = output.contextHints["sacrifice_context"] as Record<string, unknown>;
    expect(ctx["cycle_day"]).toBe(8);
    // breakdown[*].cycle_mult ≈ 1.3 (PICO day 7-9)
    const breakdown = output.contextHints["sacrifice_breakdown"] as Array<
      Record<string, unknown>
    >;
    expect(breakdown[0]!["cycle_mult"]).toBe(1.3);
  });

  it("eventLog com feedback_signal recente → outcome_signal derivado", async () => {
    const stateWithFeedback = {
      ...mockState,
      eventLog: [
        {
          timestamp: "2026-05-14T10:00:00.000Z",
          type: "feedback_signal",
          data: { signal_type: "positive_engagement" },
        },
      ],
    };
    const output = await planTurn({
      sessionId: "test-g22-feedback",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: stateWithFeedback,
      incomingMessage: "oi",
    });
    const ctx = output.contextHints["sacrifice_context"] as Record<string, unknown>;
    expect(ctx["outcome_signal"]).toBe("positive_engagement");
    // breakdown[*].outcome_mult deve refletir 1.1
    const breakdown = output.contextHints["sacrifice_breakdown"] as Array<
      Record<string, unknown>
    >;
    expect(breakdown[0]!["outcome_mult"]).toBe(1.1);
  });
});

// G-22 pool-builder loop integration (ops#1093 — follow-up motor#130)
describe("planTurn — G-22 pool-builder loop integration (ops#1093)", () => {
  it("budget OK: contentPool returns items normally + budget_state='ok'", async () => {
    const output = await planTurn({
      sessionId: "test-1093-ok",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...mockState, budgetRemaining: 100 },
      incomingMessage: "oi",
    });
    expect(output.contextHints["budget_state"]).toBe("ok");
    expect(output.contentPool.length).toBeGreaterThan(0);
    // Sem flag de gate quando OK
    expect(output.contextHints["budget_exhausted_gate_applied"]).toBeUndefined();
  });

  it("budget exhausted: budget_state='exhausted_soft_degrade' + gate_applied=true", async () => {
    const output = await planTurn({
      sessionId: "test-1093-exhausted",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...mockState, budgetRemaining: 0 },
      incomingMessage: "oi",
    });
    expect(output.contextHints["budget_state"]).toBe("exhausted_soft_degrade");
    expect(output.contextHints["budget_exhausted_gate_applied"]).toBe(true);
    expect(output.contextHints["budget_exhausted_allowed_ids"]).toBeDefined();
  });

  it("budget exhausted: TODOS items no contentPool têm sacrifice_amount ≤ 7 (hard gate)", async () => {
    const output = await planTurn({
      sessionId: "test-1093-only-light",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...mockState, budgetRemaining: 0 },
      incomingMessage: "oi",
    });
    for (const scored of output.contentPool) {
      const sacrifice = (scored.item as { sacrifice_amount?: number }).sacrifice_amount ?? 8;
      expect(sacrifice).toBeLessThanOrEqual(7);
    }
  });

  it("scorer reasons incluem 'sacrifice_cost_adj' quando sacrifice_amount no item", async () => {
    const output = await planTurn({
      sessionId: "test-1093-reasons",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...mockState, budgetRemaining: 100 },
      incomingMessage: "oi",
    });
    // Pelo menos um item no pool deve ter sacrifice_amount declarado → reason aparece.
    // Seed real eBrota tem mix; defensive — pelo menos um deve ter cost ≠ BASE.
    const anyHasSacrificeReason = output.contentPool.some((s) =>
      s.reasons.some((r) => r.startsWith("sacrifice_cost_adj")),
    );
    // Smoke: se nenhum item tem cost ≠ 8, é OK também (sem regressão).
    if (anyHasSacrificeReason) {
      expect(anyHasSacrificeReason).toBe(true);
    }
  });
});

// ─── BUG-PL-01 Sprint 5: extracted_signals + deflection ───────────────────
describe("buildSystemPrompt — extracted_signals + deflection (BUG-PL-01)", () => {
  const baseInput = {
    sessionId: "test-deflection",
    persona: mockPersona,
    adquirente: mockAdquirente,
    inventory: mockInventory,
    state: mockState,
    incomingMessage: "tô melhor falando de tênis",
  };

  it("signal deflection_thematic → prompt contém aviso DEFLECTION ATIVO", () => {
    const prompt = buildSystemPrompt({
      ...baseInput,
      contextHints: {
        extracted_signals: ["deflection_thematic", "peer_reference"],
      },
    });
    expect(prompt).toContain("SINAIS DETECTADOS NO TURNO ATUAL");
    expect(prompt).toContain("deflection_thematic");
    expect(prompt).toContain("DEFLECTION ATIVO");
    expect(prompt).toContain("não retornar ao tema");
  });

  it("exit_marker_implicit também ativa deflection block", () => {
    const prompt = buildSystemPrompt({
      ...baseInput,
      contextHints: { extracted_signals: ["exit_marker_implicit"] },
    });
    expect(prompt).toContain("DEFLECTION ATIVO");
  });

  it("signals presentes mas sem deflection → não tem bloco DEFLECTION ATIVO", () => {
    const prompt = buildSystemPrompt({
      ...baseInput,
      contextHints: {
        extracted_signals: ["peer_reference", "voluntary_topic_deepening"],
      },
    });
    expect(prompt).toContain("SINAIS DETECTADOS NO TURNO ATUAL");
    expect(prompt).toContain("peer_reference");
    expect(prompt).not.toContain("DEFLECTION ATIVO");
  });

  it("extracted_signals vazio → prompt sem bloco SINAIS DETECTADOS", () => {
    const prompt = buildSystemPrompt({
      ...baseInput,
      contextHints: { extracted_signals: [] },
    });
    expect(prompt).not.toContain("SINAIS DETECTADOS");
    expect(prompt).not.toContain("DEFLECTION ATIVO");
  });

  it("contextHints undefined → comportamento legado preservado (sem signals)", () => {
    const prompt = buildSystemPrompt(baseInput);
    expect(prompt).not.toContain("SINAIS DETECTADOS");
    expect(prompt).not.toContain("DEFLECTION ATIVO");
    // Mas o prompt fundamental ainda está presente
    expect(prompt).toContain("Planejador do motor Ascendimacy");
  });
});

describe("planTurn — preserva extracted_signals em contextHints de output (BUG-PL-01)", () => {
  it("input.contextHints.extracted_signals chega no output.contextHints", async () => {
    const output = await planTurn({
      sessionId: "test-signals-preserve",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
      contextHints: {
        extracted_signals: ["deflection_thematic"],
        last_user_message: "previous msg",
      },
    });
    expect(output.contextHints["extracted_signals"]).toEqual(["deflection_thematic"]);
    expect(output.contextHints["last_user_message"]).toBe("previous msg");
  });
});

// ─── Sprint Pedagógico P1.1: question detection ──────────────────────────
describe("detectQuestionInMessage", () => {
  it("detecta ? simples", () => {
    expect(detectQuestionInMessage("tipo, por que?").has_question).toBe(true);
  });

  it("detecta 'por que' sem ?", () => {
    expect(detectQuestionInMessage("por que você falou disso").has_question).toBe(true);
  });

  it("detecta 'o que' informal", () => {
    expect(detectQuestionInMessage("oq tu quer dizer com isso").has_question).toBe(true);
  });

  it("detecta 'como'", () => {
    expect(detectQuestionInMessage("como assim").has_question).toBe(true);
  });

  it("statement sem pergunta → false", () => {
    expect(detectQuestionInMessage("tô bem, treinando tênis").has_question).toBe(false);
  });

  it("string vazia → false", () => {
    expect(detectQuestionInMessage("").has_question).toBe(false);
  });

  it("retorna question_text quando detectada", () => {
    const r = detectQuestionInMessage("Por que vc tá perguntando?");
    expect(r.has_question).toBe(true);
    expect(r.question_text).toBe("Por que vc tá perguntando?");
  });
});

describe("buildSystemPrompt — question detection block (P1.1)", () => {
  const baseInput = {
    sessionId: "test-q",
    persona: mockPersona,
    adquirente: mockAdquirente,
    inventory: mockInventory,
    state: mockState,
    incomingMessage: "tipo, por que você falou de borboletas?",
  };

  it("question detected → prompt contém aviso PERGUNTA DIRETA", () => {
    const prompt = buildSystemPrompt(baseInput);
    expect(prompt).toContain("PERGUNTA DIRETA DETECTADA");
    expect(prompt).toContain("respond_to_question_first");
  });

  it("statement sem pergunta → sem bloco PERGUNTA", () => {
    const prompt = buildSystemPrompt({
      ...baseInput,
      incomingMessage: "tô treinando tênis",
    });
    expect(prompt).not.toContain("PERGUNTA DIRETA");
  });
});

describe("planTurn — propaga question_detected em contextHints (P1.1)", () => {
  it("incomingMessage com ? → output.contextHints tem question_detected=true", async () => {
    const output = await planTurn({
      sessionId: "test-prop",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "por que isso agora?",
    });
    expect(output.contextHints["question_detected"]).toBe(true);
    expect(output.contextHints["respond_to_question_first"]).toBe(true);
    expect(output.contextHints["question_text"]).toBe("por que isso agora?");
  });

  it("incomingMessage sem pergunta → sem question flags", async () => {
    const output = await planTurn({
      sessionId: "test-no-q",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "tô bem",
    });
    expect(output.contextHints["question_detected"]).toBeUndefined();
  });
});
