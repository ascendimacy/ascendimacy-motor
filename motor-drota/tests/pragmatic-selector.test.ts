import { describe, it, expect } from "vitest";
import { selectAction } from "../src/pragmatic-selector.js";
import type {
  ScoredContentItem,
  SessionState,
  ContentItem,
} from "@ascendimacy/shared";
import type { AssessmentResult } from "../src/unified-assessor.js";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const stubState = (budget = 15): SessionState => ({
  sessionId: "test",
  trustLevel: 0.5,
  budgetRemaining: budget,
  eventLog: [],
  turn: 1,
});

const stubAssessment = (
  overrides: Partial<AssessmentResult> = {},
): AssessmentResult => ({
  mood: 6,
  mood_confidence: "medium",
  mood_method: "rule",
  signals: [],
  engagement: "medium",
  assessment_method: "rule_only",
  rationale: "neutro",
  latency_ms: 0,
  ...overrides,
});

const item = (
  id: string,
  cost: number,
  score: number,
): ScoredContentItem => ({
  item: {
    id,
    type: "curiosity_hook",
    domain: "test",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 7,
    verified: true,
    base_score: 7,
    fact: "",
    bridge: "",
    quest: "",
    sacrifice_type: "reflect",
    sacrifice_amount: cost,
  } as ContentItem,
  score,
  reasons: [],
});

// ─────────────────────────────────────────────────────────────────────────
// Pool vazio
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — pool vazio", () => {
  it("escala Planejador com no_viable_action", () => {
    const r = selectAction({
      candidates: [],
      assessment: stubAssessment(),
      state: stubState(),
    });
    expect(r.selected).toBeNull();
    expect(r.escalate_to).toBe("planner");
    expect(r.escalate_reason).toBe("no_viable_action");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Mood ≤ 3 → cost cap 3
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — mood ≤ 3 (cost cap 3)", () => {
  it("filtra ações cost > 3 quando mood = 3", () => {
    const r = selectAction({
      candidates: [item("heavy", 8, 9), item("light", 2, 5)],
      assessment: stubAssessment({ mood: 3 }),
      state: stubState(),
    });
    expect(r.selected?.item.id).toBe("light");
    expect(r.viable_count).toBe(1);
    expect(r.decision_path).toContain("mood=3");
  });

  it("filtra ações cost > 3 quando mood = 1 (crise)", () => {
    const r = selectAction({
      candidates: [item("heavy", 5, 9), item("medium", 4, 7)],
      assessment: stubAssessment({ mood: 1 }),
      state: stubState(),
    });
    expect(r.selected).toBeNull();
    expect(r.escalate_to).toBe("planner");
  });

  it("permite ações cost ≤ 3 quando mood baixo", () => {
    const r = selectAction({
      candidates: [item("a", 1, 5), item("b", 2, 7), item("c", 3, 9)],
      assessment: stubAssessment({ mood: 2 }),
      state: stubState(),
    });
    expect(r.viable_count).toBe(3);
    expect(r.selected?.item.id).toBe("a"); // menor custo
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Budget < 10 → cost cap 5
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — budget < 10 (cost cap 5)", () => {
  it("filtra ações cost > 5 quando budget = 8", () => {
    const r = selectAction({
      candidates: [item("heavy", 7, 9), item("light", 3, 5)],
      assessment: stubAssessment({ mood: 6 }),
      state: stubState(8),
    });
    expect(r.selected?.item.id).toBe("light");
    expect(r.decision_path).toContain("budget=8");
  });

  it("budget < 10 mas todas ações > 5 → escala Planejador", () => {
    const r = selectAction({
      candidates: [item("h1", 7, 9), item("h2", 8, 5)],
      assessment: stubAssessment({ mood: 6 }),
      state: stubState(8),
    });
    expect(r.selected).toBeNull();
    expect(r.escalate_to).toBe("planner");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Engagement disengaging → cost cap 4
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — engagement disengaging (cost cap 4)", () => {
  it("filtra ações cost > 4 quando engagement = disengaging", () => {
    const r = selectAction({
      candidates: [item("heavy", 6, 9), item("ok", 3, 5)],
      assessment: stubAssessment({ mood: 6, engagement: "disengaging" }),
      state: stubState(15),
    });
    expect(r.selected?.item.id).toBe("ok");
    expect(r.decision_path).toContain("disengaging");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Criticality seguranca → escala Bridge
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — criticality:seguranca (gate)", () => {
  it("seguranca vai direto pra Bridge sem materializer", () => {
    const r = selectAction({
      candidates: [item("normal", 3, 9), item("crisis", 10, 5)],
      assessment: stubAssessment(),
      state: stubState(),
      criticalityByItemId: { crisis: "seguranca" },
    });
    expect(r.selected?.item.id).toBe("crisis");
    expect(r.escalate_to).toBe("bridge");
    expect(r.escalate_reason).toBe("criticality_seguranca");
  });

  it("sem criticality:seguranca → fluxo normal", () => {
    const r = selectAction({
      candidates: [item("a", 3, 9)],
      assessment: stubAssessment(),
      state: stubState(),
    });
    expect(r.escalate_to).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Budget exausto → modo mínimo (cost ≤ 2)
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — budget ≤ 0 modo mínimo", () => {
  it("budget = 0 com cost ≤ 2 disponível → seleciona", () => {
    const r = selectAction({
      candidates: [item("heavy", 5, 9), item("min", 2, 5), item("free", 1, 3)],
      assessment: stubAssessment(),
      state: stubState(0),
    });
    expect(r.selected?.item.id).toBe("free"); // menor cost
    expect(r.decision_path).toContain("modo mínimo");
  });

  it("budget = 0 sem cost ≤ 2 → escala Planejador", () => {
    const r = selectAction({
      candidates: [item("heavy", 5, 9), item("medium", 4, 5)],
      assessment: stubAssessment(),
      state: stubState(0),
    });
    expect(r.selected).toBeNull();
    expect(r.escalate_reason).toBe("budget_exhausted");
  });

  it("budget negativo também triggera modo mínimo", () => {
    const r = selectAction({
      candidates: [item("free", 1, 5)],
      assessment: stubAssessment(),
      state: stubState(-3),
    });
    expect(r.selected?.item.id).toBe("free");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sort menor custo + tie-break por score
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — sort + tie-break", () => {
  it("menor cost vence", () => {
    const r = selectAction({
      candidates: [item("a", 5, 9), item("b", 3, 7), item("c", 7, 8)],
      assessment: stubAssessment(),
      state: stubState(),
    });
    expect(r.selected?.item.id).toBe("b");
  });

  it("empate cost → tie-break por score (maior vence)", () => {
    const r = selectAction({
      candidates: [item("a", 3, 7), item("b", 3, 9), item("c", 5, 10)],
      assessment: stubAssessment(),
      state: stubState(),
    });
    expect(r.selected?.item.id).toBe("b"); // cost=3, score=9 > a (cost=3, score=7)
  });

  it("decision_path indica empate quando há tied candidates", () => {
    const r = selectAction({
      candidates: [item("a", 3, 8), item("b", 3, 8.02)],
      assessment: stubAssessment(),
      state: stubState(),
    });
    expect(r.decision_path).toMatch(/empate|Pulso/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Budget deduction síncrona
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — budget deduction síncrona", () => {
  it("newState.budgetRemaining < state.budgetRemaining após seleção", () => {
    const r = selectAction({
      candidates: [item("a", 4, 9)],
      assessment: stubAssessment(),
      state: stubState(15),
    });
    expect(r.budget_before).toBe(15);
    expect(r.budget_after).toBeLessThan(15);
    expect(r.newState.budgetRemaining).toBe(r.budget_after);
  });

  it("escalation NÃO deduz budget", () => {
    const r = selectAction({
      candidates: [item("h", 8, 5)],
      assessment: stubAssessment({ mood: 2 }), // cap=3, action cost=8 → fora
      state: stubState(15),
    });
    expect(r.selected).toBeNull();
    expect(r.budget_after).toBe(15);
    expect(r.newState.budgetRemaining).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// decision_path legível por humano
// ─────────────────────────────────────────────────────────────────────────

describe("selectAction — decision_path legível", () => {
  it("happy path inclui filter desc + selecionada", () => {
    const r = selectAction({
      candidates: [item("a", 3, 8)],
      assessment: stubAssessment(),
      state: stubState(),
    });
    expect(r.decision_path).toContain("a");
    expect(r.decision_path).toContain("cost=3");
  });

  it("sempre retorna string não vazia", () => {
    const r = selectAction({
      candidates: [item("a", 3, 8)],
      assessment: stubAssessment(),
      state: stubState(),
    });
    expect(r.decision_path.length).toBeGreaterThan(10);
  });
});
