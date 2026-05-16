/**
 * Integration: planTurn injeta G-07 cadence triggers + evolution assessment
 * em contextHints (ops#1020, ratified GO C 2026-05-16).
 *
 * Cobre:
 *  - `helix_active_cycle_progress` sempre presente quando kidsHelixState definido.
 *  - `helix_pending_triggers` array só presente quando há triggers pendentes.
 *  - `helix_midcycle_assessment` payload só presente quando midcycle pendente.
 *  - Backward compat: sem kidsHelixState → nenhuma key G-07 leak.
 *  - Vacation → triggers congelados (zero pending).
 *  - Idempotência: triggers já marcados não re-aparece.
 */

import { describe, it, expect } from "vitest";
import { planTurn } from "../src/plan.js";
import { bootstrapKidsHelixState } from "../src/strategist/helix-engine.js";

process.env["USE_MOCK_LLM"] = "true";

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
  {
    id: "kids.helix.session",
    title: "Helix session",
    category: "kids",
    estimatedSacrifice: 1,
    estimatedConfidenceGain: 4,
  },
];

const baseState = {
  sessionId: "test-g07",
  trustLevel: 0.3,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
};

describe("planTurn × G-07 cadence triggers (ops#1020)", () => {
  it("sem helix state → nenhuma key G-07 (backward compat com G-05 paths)", async () => {
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: baseState,
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_active_cycle_progress"]).toBeUndefined();
    expect(output.contextHints["helix_pending_triggers"]).toBeUndefined();
    expect(output.contextHints["helix_midcycle_assessment"]).toBeUndefined();
  });

  it("dia 0 → active_cycle_progress=0, sem triggers pending", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...baseState, kidsHelixState: helixState },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_active_cycle_progress"]).toBe(0);
    expect(output.contextHints["helix_pending_triggers"]).toBeUndefined();
    expect(output.contextHints["helix_midcycle_assessment"]).toBeUndefined();
  });

  it("dia 7 → triggers pending = [retrieval, midcycle] + midcycle payload presente", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: { ...helixState, current_day: 7 },
      },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_active_cycle_progress"]).toBe(0.5);
    const pending = output.contextHints["helix_pending_triggers"] as string[];
    expect(pending).toContain("retrieval_50");
    expect(pending).toContain("midcycle_assessment_7");
    expect(pending).not.toContain("boss_fight_100");

    const assessment = output.contextHints["helix_midcycle_assessment"] as
      | { evolution_percentage: number; extension_recommendation: string; reasons: string[] }
      | undefined;
    expect(assessment).toBeDefined();
    expect(typeof assessment!.evolution_percentage).toBe("number");
    expect(["standard_2_weeks", "extended_4_weeks"]).toContain(
      assessment!.extension_recommendation,
    );
    expect(Array.isArray(assessment!.reasons)).toBe(true);
  });

  it("dia 14 → adiciona boss_fight_100 ao pending", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: { ...helixState, current_day: 14, mode: "buffer" },
      },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_active_cycle_progress"]).toBe(1);
    const pending = output.contextHints["helix_pending_triggers"] as string[];
    expect(pending).toContain("boss_fight_100");
  });

  it("idempotência: triggers já marcados não aparecem em pending", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: {
          ...helixState,
          current_day: 14,
          mode: "buffer",
          triggers_fired_this_cycle: [
            "retrieval_50",
            "midcycle_assessment_7",
            "boss_fight_100",
          ],
        },
      },
      incomingMessage: "oi",
    });
    // Tudo marcado → pending vazio, key não aparece.
    expect(output.contextHints["helix_pending_triggers"]).toBeUndefined();
    expect(output.contextHints["helix_midcycle_assessment"]).toBeUndefined();
  });

  it("vacation no dia 7 → triggers congelados, sem midcycle assessment", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: {
          ...helixState,
          current_day: 7,
          mode: "vacation",
          vacation_trigger: "parental_request",
        },
      },
      incomingMessage: "oi",
    });
    // Vacation freeze: zero triggers, mas progress reportado pra audit.
    expect(output.contextHints["helix_pending_triggers"]).toBeUndefined();
    expect(output.contextHints["helix_midcycle_assessment"]).toBeUndefined();
    // active_cycle_progress reportado mesmo em vacation.
    expect(output.contextHints["helix_active_cycle_progress"]).toBe(0.5);
  });

  it("midcycle assessment consome statusMatrix do state quando disponível", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: { ...helixState, current_day: 7 },
        statusMatrix: { SA: "brejo", SOC: "brejo", SM: "baia", REL: "baia", DM: "baia" },
      },
      incomingMessage: "oi",
    });
    const assessment = output.contextHints["helix_midcycle_assessment"] as
      | { evolution_percentage: number; extension_recommendation: string; reasons: string[] }
      | undefined;
    expect(assessment).toBeDefined();
    // active_pair = [SA, SOC], ambos brejo → recommendation extended.
    expect(assessment!.extension_recommendation).toBe("extended_4_weeks");
    expect(assessment!.reasons.some((r) => r.includes("active_dim_brejo"))).toBe(true);
  });

  it("active_cycle_progress reportado independente de pending triggers existirem", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-g07",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: {
          ...helixState,
          current_day: 3, // pre-trigger zone
        },
      },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_active_cycle_progress"]).toBeCloseTo(3 / 14);
    expect(output.contextHints["helix_pending_triggers"]).toBeUndefined();
  });
});
