import { describe, it, expect } from "vitest";
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
  id: "paula-mendes",
  name: "Paula Mendes",
  age: 34,
  profile: { occupation: "analista_financeira", city: "Sao_Paulo" },
};

const mockAdquirente = {
  id: "jun",
  name: "Jun Ochiai",
  defaults: { style: "direto", language: "pt-br" },
};

const mockInventory = [
  { id: "icebreaker.primeiro-contato", title: "Icebreaker", category: "onboarding", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
  { id: "onboarding.apresentacao-produto", title: "Apresentação produto", category: "onboarding", estimatedSacrifice: 2, estimatedConfidenceGain: 3 },
];

describe("planTurn", () => {
  it("returns candidateActions with at least 1 action (mock)", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "oi, tudo bem?",
    });
    expect(output.candidateActions.length).toBeGreaterThan(0);
    expect(output.strategicRationale).toBeTruthy();
  });

  it("each candidateAction has required fields", async () => {
    const output = await planTurn({
      sessionId: "test-001",
      persona: mockPersona,
      adquirente: mockAdquirente,
      inventory: mockInventory,
      state: mockState,
      incomingMessage: "quero saber mais",
    });
    for (const action of output.candidateActions) {
      expect(action.playbookId).toBeTruthy();
      expect(typeof action.priority).toBe("number");
      expect(typeof action.estimatedSacrifice).toBe("number");
      expect(typeof action.estimatedConfidenceGain).toBe("number");
    }
  });
});
