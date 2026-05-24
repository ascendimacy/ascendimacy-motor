import { describe, it, expect } from "vitest";
import { applyTurnEvent, type TurnSnapshot } from "../../src/lib/types.js";

describe("applyTurnEvent reducer", () => {
  it("planning_started inicializa snapshot do zero", () => {
    const ev = {
      type: "planning_started" as const,
      sessionId: "s1",
      turn: 0,
      timestamp: "2026-05-24T13:00:00.000Z",
      payload: {
        strategicRationale: "rationale",
        contentPoolSize: 3,
        contentPoolIds: ["a", "b", "c"],
        contextHints: { foo: "bar" },
        transitionEvaluationsCount: 0,
      },
    };
    const snap = applyTurnEvent(null, ev);
    expect(snap.sessionId).toBe("s1");
    expect(snap.turn).toBe(0);
    expect(snap.lastPhase).toBe("planning_started");
    expect(snap.contentPoolSize).toBe(3);
    expect(snap.contentPoolIds).toEqual(["a", "b", "c"]);
    expect(snap.strategicRationale).toBe("rationale");
  });

  it("selection_made + materialization_ready acumulam no mesmo turn", () => {
    const planning: TurnSnapshot = {
      sessionId: "s1",
      turn: 0,
      lastPhase: "planning_started",
      lastTimestamp: "t0",
      strategicRationale: "rat",
      contentPoolSize: 1,
    };
    const sel = applyTurnEvent(planning, {
      type: "selection_made",
      sessionId: "s1",
      turn: 0,
      timestamp: "t1",
      payload: {
        selectedContentId: "card-a",
        selectedContentScore: 7,
        selectionRationale: "drota",
      },
    });
    expect(sel.lastPhase).toBe("selection_made");
    expect(sel.selectedContentId).toBe("card-a");
    expect(sel.strategicRationale).toBe("rat"); // preservado

    const mat = applyTurnEvent(sel, {
      type: "materialization_ready",
      sessionId: "s1",
      turn: 0,
      timestamp: "t2",
      payload: {
        proposedText: "olá",
        instructionAdditionApplied: true,
      },
    });
    expect(mat.lastPhase).toBe("materialization_ready");
    expect(mat.proposedText).toBe("olá");
    expect(mat.selectedContentId).toBe("card-a"); // preservado
  });

  it("playbook_executed completa o ciclo", () => {
    const prev: TurnSnapshot = {
      sessionId: "s1",
      turn: 0,
      lastPhase: "materialization_ready",
      lastTimestamp: "t2",
    };
    const exec = applyTurnEvent(prev, {
      type: "playbook_executed",
      sessionId: "s1",
      turn: 0,
      timestamp: "t3",
      payload: {
        playbookId: "default",
        success: true,
        newTurnNumber: 1,
      },
    });
    expect(exec.playbookId).toBe("default");
    expect(exec.playbookSuccess).toBe(true);
    expect(exec.newTurnNumber).toBe(1);
  });

  it("novo turn (turn number diferente) reseta snapshot", () => {
    const prev: TurnSnapshot = {
      sessionId: "s1",
      turn: 0,
      lastPhase: "playbook_executed",
      lastTimestamp: "t3",
      strategicRationale: "old",
      selectedContentId: "card-a",
    };
    const next = applyTurnEvent(prev, {
      type: "planning_started",
      sessionId: "s1",
      turn: 1,
      timestamp: "t4",
      payload: {
        strategicRationale: "new",
        contentPoolSize: 2,
        contentPoolIds: ["x", "y"],
        contextHints: {},
        transitionEvaluationsCount: 0,
      },
    });
    expect(next.turn).toBe(1);
    expect(next.selectedContentId).toBeUndefined();
    expect(next.strategicRationale).toBe("new");
  });

  it("sessionId diferente reseta snapshot", () => {
    const prev: TurnSnapshot = {
      sessionId: "s1",
      turn: 0,
      lastPhase: "planning_started",
      lastTimestamp: "t0",
      contentPoolIds: ["a"],
    };
    const next = applyTurnEvent(prev, {
      type: "planning_started",
      sessionId: "s2",
      turn: 0,
      timestamp: "t0",
      payload: {
        strategicRationale: "fresh",
        contentPoolSize: 0,
        contentPoolIds: [],
        contextHints: {},
        transitionEvaluationsCount: 0,
      },
    });
    expect(next.sessionId).toBe("s2");
    expect(next.contentPoolIds).toEqual([]);
  });
});
