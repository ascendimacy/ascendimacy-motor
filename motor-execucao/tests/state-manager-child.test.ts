import { describe, it, expect, beforeEach } from "vitest";
import {
  getState,
  getStateByChild,
  updateState,
  logEvent,
  closeDb,
} from "../src/state-manager.js";

beforeEach(() => {
  closeDb();
});

describe("getState — child_id linking", () => {
  it("creates session with child_id when provided", () => {
    const sessionId = `cs-link-${Date.now()}`;
    const childId = `child-link-${Date.now()}`;
    const state = getState(sessionId, childId);
    expect(state.sessionId).toBe(sessionId);
    expect(state.trustLevel).toBeCloseTo(0.3);
  });

  it("backfills child_id on existing session that had no child_id", () => {
    const sessionId = `cs-backfill-${Date.now()}`;
    const childId = `child-backfill-${Date.now()}`;
    getState(sessionId);
    updateState(sessionId, { trustLevel: 0.65 });
    getState(sessionId, childId);
    const byChild = getStateByChild(childId);
    expect(byChild.trustLevel).toBeCloseTo(0.65);
  });
});

describe("getStateByChild — cross-session aggregation (A-03 GAP-08)", () => {
  it("run 2 with same child_id sees run 1 events", () => {
    const childId = `nagareyama-test-${Date.now()}`;
    const session1 = `run1-${Date.now()}`;
    const session2 = `run2-${Date.now()}-b`;

    getState(session1, childId);
    logEvent(session1, {
      timestamp: "2026-01-01T10:00:00Z",
      type: "playbook_executed",
      data: { msg: "hello from run 1" },
    });

    closeDb();

    getState(session2, childId);
    const state = getState(session2, childId);

    expect(state.eventLog.some((e) => e.type === "playbook_executed")).toBe(true);
    expect(state.eventLog.some((e) => e.data["msg"] === "hello from run 1")).toBe(true);
  });

  it("trust_level persists from most recent session via getStateByChild", () => {
    const childId = `trust-persist-${Date.now()}`;
    const sessionA = `run-a-${Date.now()}`;
    const sessionB = `run-b-${Date.now()}-x`;

    getState(sessionA, childId);
    updateState(sessionA, { trustLevel: 0.78 });

    closeDb();

    getState(sessionB, childId);
    updateState(sessionB, { trustLevel: 0.82 });

    const byChild = getStateByChild(childId);
    expect(byChild.trustLevel).toBeCloseTo(0.82);
  });

  it("event_log aggregates across sessions up to maxEntries", () => {
    const childId = `agg-${Date.now()}`;
    const sessionA = `agg-a-${Date.now()}`;
    const sessionB = `agg-b-${Date.now()}-z`;

    getState(sessionA, childId);
    for (let i = 0; i < 5; i++) {
      logEvent(sessionA, {
        timestamp: `2026-01-01T${String(i).padStart(2, "0")}:00:00Z`,
        type: `event_run1_${i}`,
        data: {},
      });
    }

    closeDb();

    getState(sessionB, childId);
    for (let i = 0; i < 3; i++) {
      logEvent(sessionB, {
        timestamp: `2026-01-02T${String(i).padStart(2, "0")}:00:00Z`,
        type: `event_run2_${i}`,
        data: {},
      });
    }

    const byChild = getStateByChild(childId);
    expect(byChild.eventLog.length).toBe(8);
    const types = byChild.eventLog.map((e) => e.type);
    expect(types.some((t) => t.startsWith("event_run1_"))).toBe(true);
    expect(types.some((t) => t.startsWith("event_run2_"))).toBe(true);
  });

  it("getStateByChild returns empty state when no sessions exist for child", () => {
    const childId = `no-sessions-${Date.now()}`;
    const state = getStateByChild(childId);
    expect(state.sessionId).toBe(`child:${childId}`);
    expect(state.trustLevel).toBeCloseTo(0.3);
    expect(state.budgetRemaining).toBeCloseTo(100);
    expect(state.eventLog).toHaveLength(0);
  });

  it("different child_ids do not leak events to each other", () => {
    const childA = `isolate-a-${Date.now()}`;
    const childB = `isolate-b-${Date.now()}-x`;
    const sessA = `sess-ia-${Date.now()}`;
    const sessB = `sess-ib-${Date.now()}-y`;

    getState(sessA, childA);
    logEvent(sessA, { timestamp: "2026-01-01T00:00:00Z", type: "event_a", data: {} });

    getState(sessB, childB);
    logEvent(sessB, { timestamp: "2026-01-01T00:00:00Z", type: "event_b", data: {} });

    const stateA = getStateByChild(childA);
    const stateB = getStateByChild(childB);
    expect(stateA.eventLog.every((e) => e.type === "event_a")).toBe(true);
    expect(stateB.eventLog.every((e) => e.type === "event_b")).toBe(true);
  });
});
