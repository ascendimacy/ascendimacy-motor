import { describe, it, expect, beforeEach } from "vitest";
import { executePlaybook } from "../src/executor.js";
import { getState, closeDb } from "../src/state-manager.js";
import type { PlaybookInventory } from "../src/types.js";

const mockInventory: PlaybookInventory = {
  version: "test",
  playbooks: [
    {
      id: "test.icebreaker",
      title: "Icebreaker",
      category: "onboarding",
      triggers: ["oi"],
      content: "Mensagem de boas-vindas",
      estimatedSacrifice: 2,
      estimatedConfidenceGain: 3,
    },
  ],
};

describe("executePlaybook", () => {
  beforeEach(() => {
    closeDb();
  });

  it("executes known playbook and updates state", () => {
    const sessionId = `test-${Date.now()}`;
    const result = executePlaybook(
      { sessionId, playbookId: "test.icebreaker", output: "Oi! Bem-vindo.", metadata: {} },
      mockInventory
    );
    expect(result.success).toBe(true);
    expect(result.eventLogged.playbookId).toBe("test.icebreaker");
    expect(result.newState.turn).toBe(1);
    expect(result.newState.budgetRemaining).toBe(98);
  });

  it("executes unknown playbook without crashing", () => {
    const sessionId = `test-${Date.now()}`;
    const result = executePlaybook(
      { sessionId, playbookId: "unknown.playbook", output: "algo", metadata: {} },
      mockInventory
    );
    expect(result.success).toBe(true);
    expect(result.newState.turn).toBe(1);
  });

  it("getState returns initial state for new session", () => {
    const sessionId = `new-${Date.now()}`;
    const state = getState(sessionId);
    expect(state.trustLevel).toBeCloseTo(0.3);
    expect(state.budgetRemaining).toBe(100);
    expect(state.turn).toBe(0);
    expect(state.eventLog).toHaveLength(0);
  });
});
