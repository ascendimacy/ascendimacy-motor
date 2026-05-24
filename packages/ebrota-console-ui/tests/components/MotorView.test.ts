import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import MotorView from "../../src/components/MotorView.svelte";
import {
  currentTurnSnapshot,
  currentContentPool,
  consoleMode,
  currentSessionId,
} from "../../src/lib/stores.js";
import type { ApiClient } from "../../src/lib/api.js";
import type { TurnSnapshot } from "../../src/lib/types.js";

const buildApi = (): ApiClient =>
  ({
    getStatus: vi.fn(),
    getMode: vi.fn(),
    setMode: vi.fn(),
    startCardSession: vi.fn(),
    listOptions: vi.fn(async () => ({ contentPool: [] })),
    overrideSelection: vi.fn(),
    getPendingApproval: vi.fn(),
    approveOrEdit: vi.fn(),
    endSession: vi.fn(),
    turnStateSseUrl: () => "/api/sse",
  }) as never;

beforeEach(() => {
  currentTurnSnapshot.set(null);
  currentContentPool.set([]);
  consoleMode.set("auto");
  currentSessionId.set(null);
});

describe("MotorView.svelte", () => {
  it("mostra empty state quando sem snapshot", () => {
    render(MotorView, { api: buildApi() });
    expect(screen.getByTestId("motor-empty")).toBeDefined();
  });

  it("renderiza phase-tracker quando snapshot populated", () => {
    const snap: TurnSnapshot = {
      sessionId: "s1",
      turn: 3,
      lastPhase: "planning_started",
      lastTimestamp: "2026-05-24T13:00:00.000Z",
      strategicRationale: "test rationale",
      contentPoolSize: 2,
      contentPoolIds: ["a", "b"],
      contextHints: { mood: "calm" },
      transitionEvaluationsCount: 1,
    };
    currentTurnSnapshot.set(snap);
    render(MotorView, { api: buildApi() });
    expect(screen.getByTestId("phase-tracker")).toBeDefined();
    expect(screen.getByText(/Planejando/)).toBeDefined();
    expect(screen.getByText(/turn #3/)).toBeDefined();
  });

  it("renderiza rationale block expandido em planning_started", () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "planning_started",
      lastTimestamp: "t0",
      strategicRationale: "estratégia X",
      contentPoolSize: 0,
      contentPoolIds: [],
      contextHints: {},
      transitionEvaluationsCount: 0,
    });
    render(MotorView, { api: buildApi() });
    expect(screen.getByTestId("rationale-block")).toBeDefined();
    expect(screen.getByText("estratégia X")).toBeDefined();
  });

  it("mostra selection block quando selection_made aplicado", () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "selection_made",
      lastTimestamp: "t0",
      selectedContentId: "card-a",
      selectedContentScore: 8.5,
      selectionRationale: "score mais alto",
    });
    render(MotorView, { api: buildApi() });
    expect(screen.getByTestId("selection-block")).toBeDefined();
    expect(screen.getByText("card-a")).toBeDefined();
    expect(screen.getByText(/score 8\.5/)).toBeDefined();
  });

  it("mostra proposed text + instruction_addition badge", () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "materialization_ready",
      lastTimestamp: "t0",
      proposedText: "Vamos descobrir!",
      instructionAdditionApplied: true,
    });
    render(MotorView, { api: buildApi() });
    expect(screen.getByText("Vamos descobrir!")).toBeDefined();
    expect(screen.getByText(/instruction_addition aplicado/)).toBeDefined();
  });

  it("mostra playbook info + success badge no playbook_executed", () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "playbook_executed",
      lastTimestamp: "t0",
      playbookId: "kids.session",
      playbookSuccess: true,
      newTurnNumber: 1,
    });
    render(MotorView, { api: buildApi() });
    expect(screen.getByTestId("playbook-info")).toBeDefined();
    expect(screen.getByText("kids.session")).toBeDefined();
    expect(screen.getByText(/sucesso/)).toBeDefined();
  });

  it("contextHints empty NÃO renderiza bloco (evita 'No data')", () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "planning_started",
      lastTimestamp: "t0",
      strategicRationale: "x",
      contentPoolSize: 0,
      contentPoolIds: [],
      contextHints: {},
      transitionEvaluationsCount: 0,
    });
    render(MotorView, { api: buildApi() });
    expect(screen.queryByTestId("context-hints-block")).toBeNull();
  });
});
