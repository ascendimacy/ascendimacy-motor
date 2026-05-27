/**
 * Replay Fase 2 — 7 sub-seções de ReplayTurnDetail.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-7-subsistemas-redesign-v0.md
 *
 * Verifica que ReplayTurnDetail renderiza todas as 7 sub-seções com mock
 * turn data, que sub-seções vazias mostram placeholders, e que X-ray drill
 * em S3/S4/S5 popula o store global com filtro por role correto.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import ReplayTurnDetail from "../src/components/ReplayTurnDetail.svelte";
import S1ReadSection from "../src/components/replay-turn-sections/S1ReadSection.svelte";
import S2ActiveSection from "../src/components/replay-turn-sections/S2ActiveSection.svelte";
import S3DecisionSection from "../src/components/replay-turn-sections/S3DecisionSection.svelte";
import S4ExpressionSection from "../src/components/replay-turn-sections/S4ExpressionSection.svelte";
import S5GuardRecallSection from "../src/components/replay-turn-sections/S5GuardRecallSection.svelte";
import B1SocialSection from "../src/components/replay-turn-sections/B1SocialSection.svelte";
import B2DrillSection from "../src/components/replay-turn-sections/B2DrillSection.svelte";
import { llmXrayCalls, llmXrayPanelOpen } from "../src/lib/stores.js";
import type { ReplayTraceTurn, LlmCallLike } from "../src/lib/api.js";

const sampleCall = (overrides: Partial<LlmCallLike> = {}): LlmCallLike => ({
  id: "call-1",
  role: "assessor",
  provider: "anthropic",
  model: "claude-haiku-4",
  prompt: "PROMPT",
  response: "RESPONSE",
  duration_ms: 100,
  ...overrides,
});

const richTurn = (overrides: Partial<ReplayTraceTurn> = {}): ReplayTraceTurn => ({
  turnNumber: 7,
  trustLevel: 0.7,
  budgetRemaining: 12,
  playbookId: "kids.brota.v1",
  engineTrace: {
    schema_version: 2,
    turn_started_at: "2026-05-27T10:00:00Z",
    turn_completed_at: "2026-05-27T10:00:01Z",
    pre_state: {
      trust_level: 0.65,
      budget_remaining: 13,
      journey_state: {
        stage: "mapping_ready",
        discoveries_count: 4,
        families_covered: ["language", "math"],
      },
      helix_state: {
        activeDimension: "self-awareness",
        activeLevel: 2,
        cycleDay: 3,
        progress: 0.45,
      },
    },
    post_state: {
      trust_level: 0.7,
      budget_remaining: 12,
    },
    state_diff: {
      trust_delta: 0.05,
      budget_delta: -1,
      subject_knowledge_added_count: 2,
    },
    components: {
      unified_assessor: {
        inputs: { user_message: "oi" },
        outputs: { mood: 0.6, signals: ["curious"], engagement: "high" },
        mood_method: "llm",
        duration_ms: 320,
      },
      planejador: {
        outputs: {
          contentPool: [
            { item: { id: "x.1" }, score: 0.8, reasons: ["match"] },
            { item: { id: "x.2" }, score: 0.6, reasons: ["fallback"] },
          ],
          strategicRationale: "explorar interesse pela ciência",
          candidateSetEntropy: 1.234,
        },
        triageDecision: { route: "drota", reason: "no_critical_flag" },
        triggerEvaluation: {
          transitions_checked: ["discovery_to_mapping"],
          fired: "discovery_to_mapping",
        },
        duration_ms: 420,
      },
      pragmatic_selector: {
        inputs: { pool_size: 2, mood: 0.6, budget: 12 },
        filters_applied: [{ name: "recently_used", items_removed: [], reason: "ok" }],
        outputs: { selected_id: "x.1", pool_remaining: ["x.2"] },
        duration_ms: 12,
      },
      constrained_materializer: {
        inputs: { selected_item_id: "x.1", user_message: "oi" },
        stable_prefix_hash: "abc123def456abc123def456",
        outputs: { raw_response: "Oi! Vamos lá?", final_text: "Oi! Vamos lá?" },
        llm_call_ref: "call-mat-1",
        duration_ms: 600,
      },
    },
    llm_calls: [
      sampleCall({ id: "call-ass-1", role: "assessor" }),
      sampleCall({ id: "call-pla-1", role: "planejador" }),
      sampleCall({
        id: "call-mat-1",
        role: "materializer",
        prompt_cache_hit: true,
      }),
    ],
    subject_knowledge_writes: [],
    warnings: [],
    tactic_decision: {
      jogada: "bridge",
      selected_item_id: "x.1",
      angle: "começar pela curiosidade",
      rationale: "alto engajamento + journey mapping_ready",
      constraints: { avoid: [], register: "lúdico" },
    },
  },
  subjectKnowledgeEvents: [
    {
      type: "recall_check_attempt",
      payload: { concept_id: "ciclo_lua", outcome: "correct" },
    },
    {
      type: "boundary_event",
      payload: { topic_category: "violencia", label: "soft-touch" },
    },
  ],
  ...overrides,
});

beforeEach(() => {
  llmXrayCalls.set([]);
  llmXrayPanelOpen.set(false);
});

afterEach(() => {
  cleanup();
  llmXrayCalls.set([]);
  llmXrayPanelOpen.set(false);
});

describe("ReplayTurnDetail — 7 sub-seções render", () => {
  it("renderiza todas as 7 sub-seções (S1-S5 + B1-B2)", () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    expect(screen.getByTestId("section-S1")).toBeDefined();
    expect(screen.getByTestId("section-S2")).toBeDefined();
    expect(screen.getByTestId("section-S3")).toBeDefined();
    expect(screen.getByTestId("section-S4")).toBeDefined();
    expect(screen.getByTestId("section-S5")).toBeDefined();
    expect(screen.getByTestId("section-B1")).toBeDefined();
    expect(screen.getByTestId("section-B2")).toBeDefined();
  });

  it("renderiza 7 sub-seções mesmo com turn v1-only (motorTrace, sem engineTrace)", () => {
    const v1Turn: ReplayTraceTurn = {
      turnNumber: 1,
      trustLevel: 0.5,
      motorTrace: {
        plan: {
          strategicRationale: "fallback v1",
          contentPool: [{ item: { id: "v1.1" }, score: 0.5 }],
        },
        drota: { selectedContent: { item: { id: "v1.1" }, score: 0.5 } },
      },
    };
    render(ReplayTurnDetail, { turn: v1Turn });
    for (const id of ["S1", "S2", "S3", "S4", "S5", "B1", "B2"]) {
      expect(screen.getByTestId(`section-${id}`)).toBeDefined();
    }
  });

  it("turn minimal (apenas turnNumber) — sub-seções renderizam empty states sem crash", () => {
    render(ReplayTurnDetail, { turn: { turnNumber: 0 } });
    for (const id of ["S1", "S2", "S3", "S4", "S5", "B1", "B2"]) {
      expect(screen.getByTestId(`section-${id}`)).toBeDefined();
    }
    expect(screen.getByTestId("section-B2-empty")).toBeDefined();
  });

  it("badge v2 visível quando engineTrace presente", () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    expect(screen.getByTestId("v2-badge")).toBeDefined();
  });

  it("state-diff badges renderizam quando deltas !== 0", () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    expect(screen.getByTestId("state-trust-delta")).toBeDefined();
    expect(screen.getByTestId("state-budget-delta")).toBeDefined();
  });
});

describe("ReplayTurnDetail — X-ray drill por role (S3/S4/S5)", () => {
  it("S3 X-ray button popula llmXrayCalls filtrado por roles de decisão", async () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    const btn = screen.getByTestId("section-S3-xray-btn");
    expect(btn).toBeDefined();

    await fireEvent.click(btn);

    expect(get(llmXrayPanelOpen)).toBe(true);
    const calls = get(llmXrayCalls);
    expect(calls.map((c) => c.role).sort()).toEqual(["assessor", "planejador"]);
  });

  it("S4 X-ray button popula llmXrayCalls filtrado por roles de expressão", async () => {
    render(ReplayTurnDetail, { turn: richTurn() });
    const btn = screen.getByTestId("section-S4-xray-btn");
    expect(btn).toBeDefined();

    await fireEvent.click(btn);

    expect(get(llmXrayPanelOpen)).toBe(true);
    const calls = get(llmXrayCalls);
    expect(calls.every((c) => ["materializer", "tactician", "speaker"].includes(c.role)))
      .toBe(true);
    expect(calls.map((c) => c.id)).toContain("call-mat-1");
  });

  it("S3 X-ray button ausente quando não há calls de roles de decisão", () => {
    const t = richTurn();
    if (t.engineTrace) {
      t.engineTrace.llm_calls = [sampleCall({ id: "c-only-mat", role: "materializer" })];
    }
    render(ReplayTurnDetail, { turn: t });
    expect(screen.queryByTestId("section-S3-xray-btn")).toBeNull();
    expect(screen.getByTestId("section-S4-xray-btn")).toBeDefined();
  });

  it("nenhum X-ray button quando engineTrace ausente", () => {
    render(ReplayTurnDetail, { turn: { turnNumber: 1 } });
    expect(screen.queryByTestId("section-S3-xray-btn")).toBeNull();
    expect(screen.queryByTestId("section-S4-xray-btn")).toBeNull();
    expect(screen.queryByTestId("section-S5-xray-btn")).toBeNull();
  });
});

describe("sub-seções standalone — empty states + placeholders", () => {
  it("S1 mostra 'não houve snapshot' quando turn sem dados", () => {
    render(S1ReadSection, { turn: { turnNumber: 1 } });
    expect(screen.getByTestId("section-S1")).toBeDefined();
    expect(screen.getByText(/não houve snapshot pré-turn/)).toBeDefined();
  });

  it("S1 mostra journey + helix do pre_state quando disponíveis", () => {
    render(S1ReadSection, { turn: richTurn() });
    expect(screen.getByText(/mapping_ready/)).toBeDefined();
    expect(screen.getByText(/self-awareness/)).toBeDefined();
  });

  it("S2 mostra jogada badge quando tactic_decision presente", () => {
    render(S2ActiveSection, { turn: richTurn() });
    expect(screen.getByTestId("section-S2-jogada")).toBeDefined();
    expect(screen.getByTestId("section-S2-jogada").textContent).toContain("bridge");
  });

  it("S2 mostra 'sem dado' quando turn sem playbook nem jogada", () => {
    render(S2ActiveSection, { turn: { turnNumber: 1 } });
    expect(screen.getByText(/não houve doutrina/)).toBeDefined();
  });

  it("S3 mostra pool count + rationale", () => {
    render(S3DecisionSection, { turn: richTurn() });
    expect(screen.getByTestId("section-S3-pool").textContent).toContain("2 pool");
    expect(screen.getByText(/explorar interesse pela ciência/)).toBeDefined();
  });

  it("S3 critical badge aparece quando triage.route === 'parental'", () => {
    const t = richTurn();
    if (t.engineTrace?.components?.planejador) {
      t.engineTrace.components.planejador.triageDecision = {
        route: "parental",
        reason: "parental_question",
      };
    }
    render(S3DecisionSection, { turn: t });
    expect(screen.getByTestId("section-S3-critical")).toBeDefined();
  });

  it("S4 mostra final_text + cache hit badge", () => {
    render(S4ExpressionSection, { turn: richTurn() });
    expect(screen.getByTestId("section-S4-final-text")).toBeDefined();
    expect(screen.getByTestId("section-S4-cache-hit")).toBeDefined();
  });

  it("S4 mostra fallback badge quando speaker.retried_with_fallback=true", () => {
    const t = richTurn();
    if (t.engineTrace?.components) {
      t.engineTrace.components.speaker = {
        inputs: { jogada: "bridge", selected_item_id: "x.1", user_message: "oi" },
        stable_prefix_hash: "h",
        user_message_constructed: "oi",
        outputs: { raw_response: "raw", final_text: "final" },
        retried_with_fallback: true,
        llm_call_ref: "call-speaker-1",
        duration_ms: 100,
      };
    }
    render(S4ExpressionSection, { turn: t });
    expect(screen.getByTestId("section-S4-fallback")).toBeDefined();
  });

  it("S5 mostra recall + boundary counts quando subjectKnowledgeEvents tem ambos", () => {
    render(S5GuardRecallSection, { turn: richTurn() });
    expect(screen.getByTestId("section-S5-recall-count").textContent).toContain("1");
    expect(screen.getByTestId("section-S5-boundary-count").textContent).toContain("1");
  });

  it("S5 mostra 'não houve' quando turn sem eventos / warnings", () => {
    render(S5GuardRecallSection, { turn: { turnNumber: 1 } });
    expect(screen.getByText(/não houve evento de guardrail/)).toBeDefined();
  });

  it("B1 mostra 'não houve' quando turn sem cards/cost/pulse", () => {
    render(B1SocialSection, { turn: richTurn() });
    expect(screen.getByText(/não houve emissão social/)).toBeDefined();
  });

  it("B1 mostra cards count quando cardsEmitted preenchido", () => {
    render(B1SocialSection, {
      turn: { turnNumber: 1, cardsEmitted: [{ id: "card-a" }, { id: "card-b" }] },
    });
    expect(screen.getByTestId("section-B1-cards-count").textContent).toContain("2 cards");
  });

  it("B2 default = 'não houve' (B2 ausente como sistema)", () => {
    render(B2DrillSection, { turn: richTurn() });
    expect(screen.getByTestId("section-B2-empty")).toBeDefined();
    expect(screen.getByText(/B2 ainda ausente como sistema/)).toBeDefined();
  });

  it("B2 mostra correct/incorrect badges quando drillAttempts presente", () => {
    render(B2DrillSection, {
      turn: {
        turnNumber: 1,
        drillAttempts: [
          { item_id: "d1", correct: true },
          { item_id: "d2", correct: false, expected: "5", given: "6" },
        ],
      },
    });
    expect(screen.getByTestId("section-B2-correct").textContent).toContain("1");
    expect(screen.getByTestId("section-B2-incorrect").textContent).toContain("1");
  });
});
