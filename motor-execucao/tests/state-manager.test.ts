import { describe, it, expect, beforeEach } from "vitest";
import { getState, updateState, closeDb } from "../src/state-manager.js";

beforeEach(() => {
  closeDb();
});

describe("updateState — partial delta preservation", () => {
  it("preserves trustLevel and budgetRemaining when only turn is updated", () => {
    const sessionId = `sm-test-${Date.now()}`;
    getState(sessionId); // cria row com defaults
    updateState(sessionId, { trustLevel: 0.7, budgetRemaining: 80, turn: 1 });
    updateState(sessionId, { turn: 5 }); // só turn
    const state = getState(sessionId);
    expect(state.turn).toBe(5);
    expect(state.trustLevel).toBeCloseTo(0.7);
    expect(state.budgetRemaining).toBeCloseTo(80);
  });

  it("preserves budgetRemaining and turn when only trustLevel is updated", () => {
    const sessionId = `sm-test-${Date.now()}`;
    getState(sessionId);
    updateState(sessionId, { trustLevel: 0.3, budgetRemaining: 90, turn: 2 });
    updateState(sessionId, { trustLevel: 0.6 });
    const state = getState(sessionId);
    expect(state.trustLevel).toBeCloseTo(0.6);
    expect(state.budgetRemaining).toBeCloseTo(90);
    expect(state.turn).toBe(2);
  });

  it("does not throw when session does not exist", () => {
    const sessionId = `nonexistent-${Date.now()}`;
    expect(() => updateState(sessionId, { turn: 1 })).not.toThrow();
  });
});
