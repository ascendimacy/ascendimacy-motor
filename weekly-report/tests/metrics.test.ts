import { describe, it, expect } from "vitest";
import type {
  SessionTrace,
  StatusMatrix,
  GardnerProgramState,
  TurnTrace,
} from "@ascendimacy/shared";
import { computeMetrics } from "../src/metrics.js";

function turn(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    turnNumber: 0,
    sessionId: "s1",
    incomingMessage: "x",
    entries: [],
    finalResponse: "y",
    ...overrides,
  };
}

function trace(id: string, turns: TurnTrace[]): SessionTrace {
  return {
    sessionId: id,
    persona: "ryo",
    startedAt: "2026-04-20T10:00:00.000Z",
    turns,
    meta: { schemaVersion: "0.3.0", motorVersion: "0.3.0" },
  };
}

describe("computeMetrics — off/on screen ratio", () => {
  it("classifies curiosity_hook reflect as on-screen", () => {
    const t = trace("s1", [
      turn({
        selectedContent: {
          id: "h",
          type: "curiosity_hook",
          score: 7,
          domain: "x",
          surprise: 8,
          sacrifice_type: "reflect",
        },
      }),
    ]);
    const m = computeMetrics([t]);
    expect(m.off_on_screen_ratio.on).toBe(1);
    expect(m.off_on_screen_ratio.off).toBe(0);
  });

  it("classifies challenge/dynamic/gtd_task as off-screen", () => {
    const t = trace("s1", [
      turn({ turnNumber: 0, selectedContent: { id: "c1", type: "challenge", score: 7, domain: "x", surprise: 8 } }),
      turn({ turnNumber: 1, selectedContent: { id: "d1", type: "dynamic", score: 7, domain: "x", surprise: 8 } }),
      turn({ turnNumber: 2, selectedContent: { id: "t1", type: "gtd_task", score: 7, domain: "x", surprise: 8 } }),
    ]);
    const m = computeMetrics([t]);
    expect(m.off_on_screen_ratio.off).toBe(3);
    expect(m.off_on_screen_ratio.on).toBe(0);
  });

  it("sacrifice_type act/create/observe force off-screen", () => {
    const t = trace("s1", [
      turn({ selectedContent: { id: "a", type: "curiosity_hook", score: 7, domain: "x", surprise: 8, sacrifice_type: "act" } }),
    ]);
    const m = computeMetrics([t]);
    expect(m.off_on_screen_ratio.off).toBe(1);
  });

  it("ratio=0 when no off-screen", () => {
    const t = trace("s1", [turn({ selectedContent: { id: "h", type: "curiosity_hook", score: 7, domain: "x", surprise: 8, sacrifice_type: "reflect" } })]);
    expect(computeMetrics([t]).off_on_screen_ratio.ratio).toBe(0);
  });

  it("ratio=Infinity quando tudo off-screen", () => {
    const t = trace("s1", [turn({ selectedContent: { id: "c", type: "challenge", score: 7, domain: "x", surprise: 8 } })]);
    expect(computeMetrics([t]).off_on_screen_ratio.ratio).toBe(Infinity);
  });
});

describe("computeMetrics — sessions in brejo", () => {
  it("counts 1 when any turn tem dimensão brejo", () => {
    const matrix: StatusMatrix = { emotional: "brejo" };
    const t = trace("s1", [turn({ statusSnapshot: matrix })]);
    expect(computeMetrics([t]).sessions_in_brejo).toBe(1);
  });

  it("counts 0 quando todas dimensões são baia/pasto", () => {
    const matrix: StatusMatrix = { emotional: "baia", cognitive_math: "pasto" };
    const t = trace("s1", [turn({ statusSnapshot: matrix })]);
    expect(computeMetrics([t]).sessions_in_brejo).toBe(0);
  });

  it("não conta mesma sessão duas vezes", () => {
    const matrix: StatusMatrix = { emotional: "brejo" };
    const t = trace("s1", [
      turn({ turnNumber: 0, statusSnapshot: matrix }),
      turn({ turnNumber: 1, statusSnapshot: matrix }),
    ]);
    expect(computeMetrics([t]).sessions_in_brejo).toBe(1);
  });
});

describe("computeMetrics — program pause frequency", () => {
  it("conta pauses por sessão", () => {
    const paused: GardnerProgramState = {
      current_week: 1,
      current_day: 1,
      current_phase: "exploration_in_strength",
      paused: true,
      paused_reason: "emotional_brejo",
      phases_completed: 0,
      consecutive_missed_milestones: 0,
    };
    const notPaused: GardnerProgramState = { ...paused, paused: false };
    const t1 = trace("s1", [turn({ gardnerProgramSnapshot: paused })]);
    const t2 = trace("s2", [turn({ gardnerProgramSnapshot: notPaused })]);
    const m = computeMetrics([t1, t2]);
    expect(m.program_pause_frequency).toBe(0.5);
  });

  it("frequency=0 quando nenhuma sessão", () => {
    expect(computeMetrics([]).program_pause_frequency).toBe(0);
  });
});

describe("computeMetrics — missed milestones", () => {
  it("usa último snapshot", () => {
    const prog = (n: number): GardnerProgramState => ({
      current_week: 1,
      current_day: 1,
      current_phase: "exploration_in_strength",
      paused: false,
      phases_completed: 0,
      consecutive_missed_milestones: n,
    });
    const t = trace("s1", [
      turn({ turnNumber: 0, gardnerProgramSnapshot: prog(0) }),
      turn({ turnNumber: 1, gardnerProgramSnapshot: prog(2) }),
    ]);
    expect(computeMetrics([t]).missed_milestones_total).toBe(2);
  });
});

describe("computeMetrics — totals", () => {
  it("soma sacrifice + screen seconds", () => {
    const t = trace("s1", [
      turn({ turnNumber: 0, sacrificeSpent: 2, screenSeconds: 60 }),
      turn({ turnNumber: 1, sacrificeSpent: 3, screenSeconds: 120 }),
    ]);
    const m = computeMetrics([t]);
    expect(m.total_turns).toBe(2);
    expect(m.avg_sacrifice_per_turn).toBe(2.5);
    expect(m.total_screen_seconds).toBe(180);
  });

  it("traces vazios retornam métricas zero", () => {
    const m = computeMetrics([]);
    expect(m.total_turns).toBe(0);
    expect(m.total_sessions).toBe(0);
    expect(m.avg_sacrifice_per_turn).toBe(0);
  });
});
