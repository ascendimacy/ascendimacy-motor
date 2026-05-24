import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import ContentPool from "../../src/components/ContentPool.svelte";
import {
  consoleMode,
  currentContentPool,
  currentSessionId,
  currentTurnSnapshot,
  globalError,
} from "../../src/lib/stores.js";
import type { ApiClient } from "../../src/lib/api.js";

const buildApi = (
  overrides: Partial<ApiClient> = {},
): ApiClient =>
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
    ...overrides,
  }) as never;

beforeEach(() => {
  consoleMode.set("auto");
  currentSessionId.set(null);
  currentContentPool.set([]);
  currentTurnSnapshot.set(null);
  globalError.set(null);
});

describe("ContentPool.svelte — display logic", () => {
  it("mostra empty state quando sem pool e sem snapshot", () => {
    render(ContentPool, { api: buildApi() });
    expect(screen.getByTestId("pool-empty")).toBeDefined();
  });

  it("popula a partir de snapshot.contentPoolIds em auto mode (fallback)", () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "planning_started",
      lastTimestamp: "t0",
      contentPoolIds: ["card-a", "card-b", "card-c"],
      contentPoolSize: 3,
      contextHints: {},
      transitionEvaluationsCount: 0,
    });
    render(ContentPool, { api: buildApi() });
    expect(screen.getAllByTestId("pool-card").length).toBe(3);
  });

  it("popula com fact/score quando pool full disponível", () => {
    currentContentPool.set([
      {
        item: { id: "card-a", type: "curiosity_hook", fact: "fato A" },
        score: 9,
      },
      {
        item: { id: "card-b", type: "sacrifice", fact: "fato B" },
        score: 7,
      },
    ]);
    render(ContentPool, { api: buildApi() });
    expect(screen.getByText("fato A")).toBeDefined();
    expect(screen.getByText("fato B")).toBeDefined();
    expect(screen.getByText(/score 9\.0/)).toBeDefined();
  });

  it("topN limita visíveis com toggle expand", async () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "planning_started",
      lastTimestamp: "t0",
      contentPoolIds: ["a", "b", "c", "d", "e"],
      contentPoolSize: 5,
      contextHints: {},
      transitionEvaluationsCount: 0,
    });
    render(ContentPool, { api: buildApi(), topN: 2 });
    expect(screen.getAllByTestId("pool-card").length).toBe(2);
    const toggle = screen.getByTestId("expand-toggle");
    expect(toggle.textContent).toContain("Mostrar todas");
    await fireEvent.click(toggle);
    expect(screen.getAllByTestId("pool-card").length).toBe(5);
  });

  it("marca selected badge na carta selecionada", () => {
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "selection_made",
      lastTimestamp: "t0",
      contentPoolIds: ["a", "b"],
      selectedContentId: "b",
    });
    render(ContentPool, { api: buildApi() });
    expect(screen.getByText(/selecionado/)).toBeDefined();
  });
});

describe("ContentPool.svelte — semi-auto override", () => {
  it("auto mode: NÃO mostra override buttons", () => {
    consoleMode.set("auto");
    currentTurnSnapshot.set({
      sessionId: "s1",
      turn: 0,
      lastPhase: "planning_started",
      lastTimestamp: "t0",
      contentPoolIds: ["a", "b"],
      contentPoolSize: 2,
      contextHints: {},
      transitionEvaluationsCount: 0,
    });
    render(ContentPool, { api: buildApi() });
    expect(screen.queryAllByTestId("override-button").length).toBe(0);
  });

  it("semi-auto: mostra override buttons (exceto na carta selected)", async () => {
    consoleMode.set("semi-auto");
    currentSessionId.set("sess-1");
    // listOptions retorna o pool; polling vai re-setar currentContentPool
    const apiWithPool = buildApi({
      listOptions: vi.fn(async () => ({
        contentPool: [
          { item: { id: "card-a" }, score: 9 },
          { item: { id: "card-b" }, score: 7 },
        ],
      })),
    });
    currentTurnSnapshot.set({
      sessionId: "sess-1",
      turn: 0,
      lastPhase: "selection_made",
      lastTimestamp: "t0",
      selectedContentId: "card-a",
    });
    render(ContentPool, { api: apiWithPool });
    await new Promise<void>((r) => setTimeout(r, 60));
    const buttons = screen.queryAllByTestId("override-button");
    expect(buttons.length).toBe(1);
  });

  it("override click chama api.overrideSelection com contentItemId correto", async () => {
    consoleMode.set("semi-auto");
    currentSessionId.set("sess-1");
    const overrideSelection = vi.fn(async () => ({
      accepted: true,
      foundInPool: true,
      gateWasActive: true,
    }));
    const apiWithPool = buildApi({
      listOptions: vi.fn(async () => ({
        contentPool: [{ item: { id: "card-x" }, score: 8 }],
      })),
      overrideSelection,
    });
    render(ContentPool, { api: apiWithPool });
    await new Promise<void>((r) => setTimeout(r, 60));
    const btn = screen.getByTestId("override-button");
    await fireEvent.click(btn);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(overrideSelection).toHaveBeenCalledWith("sess-1", "card-x");
  });

  it("override rejected: gateWasActive=false → globalError populado", async () => {
    consoleMode.set("semi-auto");
    currentSessionId.set("sess-1");
    const overrideSelection = vi.fn(async () => ({
      accepted: false,
      foundInPool: false,
      gateWasActive: false,
    }));
    const apiWithPool = buildApi({
      listOptions: vi.fn(async () => ({
        contentPool: [{ item: { id: "card-x" }, score: 8 }],
      })),
      overrideSelection,
    });
    render(ContentPool, { api: apiWithPool });
    await new Promise<void>((r) => setTimeout(r, 60));
    const btn = screen.getByTestId("override-button");
    await fireEvent.click(btn);
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(get(globalError)).toContain("Override falhou");
  });
});
