/**
 * Integration: planTurn injeta contextHints helix quando kidsHelixState
 * presente em SessionState (G-05, ops#1091).
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
  sessionId: "test-helix",
  trustLevel: 0.3,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
};

describe("planTurn × KidsHelixState (G-05 integration)", () => {
  it("sem helix state → contextHints sem helix_* keys (backward compat)", async () => {
    const output = await planTurn({
      sessionId: "test-helix",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: baseState,
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_active_pair"]).toBeUndefined();
    expect(output.contextHints["helix_cycle_progress"]).toBeUndefined();
  });

  it("com helix state ativo → injeta active_pair + cycle_progress + cycle_day + mode", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-helix",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...baseState, kidsHelixState: helixState },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_active_pair"]).toEqual(["SA", "SOC"]);
    expect(output.contextHints["helix_cycle_progress"]).toBe(0);
    expect(output.contextHints["helix_cycle_day"]).toBe(0);
    expect(output.contextHints["helix_mode"]).toBe("active");
    expect(output.contextHints["helix_cycles_completed"]).toBe(0);
    expect(output.contextHints["helix_previous_pair"]).toBeUndefined();
  });

  it("com previous_pair populado → contextHints helix_previous_pair", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-helix",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: {
          ...helixState,
          previous_pair: ["DM", "REL"],
          cycles_completed: 3,
          current_day: 9,
        },
      },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_previous_pair"]).toEqual(["DM", "REL"]);
    expect(output.contextHints["helix_cycles_completed"]).toBe(3);
    expect(output.contextHints["helix_cycle_day"]).toBe(9);
    // Day 9 / 18 = 0.5 → G-07 50% trigger zone.
    expect(output.contextHints["helix_cycle_progress"]).toBeCloseTo(9 / 18);
  });

  it("vacation mode → injeta helix_vacation_trigger", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-helix",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: {
          ...helixState,
          mode: "vacation",
          vacation_trigger: "parental_request",
          vacation_started_at: "2026-05-15T00:00:00.000Z",
        },
      },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_mode"]).toBe("vacation");
    expect(output.contextHints["helix_vacation_trigger"]).toBe("parental_request");
  });

  it("deferred dims populados → contextHints helix_deferred_dims", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-helix",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: { ...helixState, deferred: ["DM"] },
      },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_deferred_dims"]).toEqual(["DM"]);
  });

  it("vacation sem trigger → vacation_trigger ausente do contextHints", async () => {
    const helixState = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: "2026-05-16T12:00:00.000Z",
    });
    const output = await planTurn({
      sessionId: "test-helix",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: {
        ...baseState,
        kidsHelixState: { ...helixState, mode: "vacation" },
      },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_vacation_trigger"]).toBeUndefined();
    expect(output.contextHints["helix_mode"]).toBe("vacation");
  });
});
