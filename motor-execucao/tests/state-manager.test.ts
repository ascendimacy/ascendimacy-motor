import { describe, it, expect, beforeEach } from "vitest";
import { getState, updateState, closeDb, getDbInstance } from "../src/state-manager.js";
import { applyStatusTransition } from "../src/tree-nodes.js";

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

describe("getState — hydrates statusMatrix (Bloco 2a)", () => {
  it("new session comes with default matrix (all baia)", () => {
    const sessionId = `sm-new-${Date.now()}`;
    const state = getState(sessionId);
    expect(state.statusMatrix).toBeDefined();
    expect(state.statusMatrix!["emotional"]).toBe("baia");
    expect(state.statusMatrix!["social_with_ebrota"]).toBe("baia");
  });

  it("persisted status transitions are reflected in next getState", () => {
    const sessionId = `sm-persist-${Date.now()}`;
    getState(sessionId); // creates row
    const db = getDbInstance();
    applyStatusTransition(db, sessionId, "emotional", "brejo");
    applyStatusTransition(db, sessionId, "cognitive_math", "pasto");
    const reloaded = getState(sessionId);
    expect(reloaded.statusMatrix!["emotional"]).toBe("brejo");
    expect(reloaded.statusMatrix!["cognitive_math"]).toBe("pasto");
  });

  it("different sessions do not leak statusMatrix", () => {
    const a = `sm-a-${Date.now()}`;
    const b = `sm-b-${Date.now()}-other`;
    getState(a);
    getState(b);
    const db = getDbInstance();
    applyStatusTransition(db, a, "emotional", "brejo");
    expect(getState(a).statusMatrix!["emotional"]).toBe("brejo");
    expect(getState(b).statusMatrix!["emotional"]).toBe("baia");
  });
});
