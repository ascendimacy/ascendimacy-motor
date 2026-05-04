import { describe, it, expect, beforeAll } from "vitest";
import { planTurn } from "../src/plan.js";

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

  it("phase=solo helix injects casel_focus_dim and helix_phase", async () => {
    const helixState = {
      userId: "ryo",
      activeDimension: "SA" as const,
      activeLevel: "emerging" as const,
      progress: 0.3,
      cycleDay: 1,
      cycleStart: "2026-05-01",
      previousDimension: null,
      retrievalDone: false,
      estimatedCycleDays: 18,
      queue: ["SOC", "SM", "REL", "DM"] as ("SA"|"SM"|"SOC"|"REL"|"DM")[],
      deferred: [],
      completed: [],
      vacationModeActive: false,
    };
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
      helixState,
    });
    expect(output.contextHints["helix_phase"]).toBe("solo");
    expect(output.contextHints["helix_progress"]).toBe(0.3);
    expect(output.contextHints["casel_focus_dim"]).toBe("SA");
    expect(output.contextHints["casel_focus_level"]).toBe("emerging");
    expect(output.contextHints["casel_retrieval_dim"]).toBeUndefined();
  });

  it("phase=retrieval helix exposes previousDimension when progress>=0.5", async () => {
    const helixState = {
      userId: "ryo",
      activeDimension: "SOC" as const,
      activeLevel: "emerging" as const,
      progress: 0.6,
      cycleDay: 8,
      cycleStart: "2026-05-01",
      previousDimension: "SA" as const,
      retrievalDone: false,
      estimatedCycleDays: 18,
      queue: ["SM", "REL", "DM"] as ("SA"|"SM"|"SOC"|"REL"|"DM")[],
      deferred: [],
      completed: ["SA"] as ("SA"|"SM"|"SOC"|"REL"|"DM")[],
      vacationModeActive: false,
    };
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi",
      helixState,
    });
    expect(output.contextHints["helix_phase"]).toBe("retrieval");
    expect(output.contextHints["casel_retrieval_dim"]).toBe("SA");
  });

  it("falls back to statusMatrix when helixState undefined", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: { ...mockState, statusMatrix: { emotional: "brejo", social_with_ebrota: "baia" } },
      incomingMessage: "oi",
    });
    expect(output.contextHints["helix_phase"]).toBeUndefined();
    expect(output.contextHints["casel_focus_dimension"]).toBe("emotional");
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
