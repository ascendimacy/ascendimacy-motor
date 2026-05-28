/**
 * B2DrillingPanel — render com mock ApiClient.
 *
 * Cobre:
 *  - loading state
 *  - empty state quando persona não tem drill (states=0)
 *  - blocos populados com banks/due/mastered/stats
 *  - error state
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/svelte";
import B2DrillingPanel from "../src/components/subsystem-panels/B2DrillingPanel.svelte";
import { expandedSubsystem, tracerSubjectId } from "../src/lib/stores.js";
import type { ApiClient, DrillStateLike } from "../src/lib/api.js";

function buildApi(over: Partial<ApiClient> = {}): ApiClient {
  const base: Partial<ApiClient> = {
    listBanks: vi.fn().mockResolvedValue({ banks: [] }),
    listDrillStates: vi.fn().mockResolvedValue({ states: [] }),
    listDrillDue: vi.fn().mockResolvedValue({ states: [] }),
    listDrillMastered: vi.fn().mockResolvedValue({ states: [] }),
    listDrillAttempts: vi.fn().mockResolvedValue({ attempts: [] }),
  };
  return { ...base, ...over } as ApiClient;
}

function makeState(over: Partial<DrillStateLike> = {}): DrillStateLike {
  return {
    persona_id: "ryo-ochiai",
    item_id: "jpv-001",
    presented_count: 3,
    correct_count: 2,
    last_seen_at: "2026-05-27T10:00:00.000Z",
    next_due_at: "2026-05-30T10:00:00.000Z",
    current_interval_days: 3,
    current_easiness: 2.5,
    mastery_reached_at: null,
    last_5_attempts: ["correct", "incorrect", "correct"],
    ...over,
  };
}

beforeEach(() => {
  expandedSubsystem.set("B2");
  tracerSubjectId.set("ryo-ochiai");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("B2DrillingPanel", () => {
  it("mostra loading enquanto carrega", () => {
    const api = buildApi();
    render(B2DrillingPanel, { props: { api } });
    expect(screen.getByTestId("b2-loading")).toBeDefined();
  });

  it("mostra empty state quando persona nunca drilou", async () => {
    const api = buildApi({
      listBanks: vi.fn().mockResolvedValue({
        banks: [
          {
            bank_id: "ja-pt-vocab-n5",
            title: "JP-PT N5",
            curator: "jun",
            item_count: 50,
            target_personas: ["ryo-ochiai"],
          },
        ],
      }),
    });
    render(B2DrillingPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("b2-loading")).toBeNull();
    });
    expect(screen.getByTestId("b2-empty-state")).toBeDefined();
    expect(screen.getByText(/primeiro turn dispara/)).toBeDefined();
    // banks bloco sempre renderiza
    expect(screen.getByText("JP-PT N5")).toBeDefined();
  });

  it("renderiza due + mastered + stats com dados completos", async () => {
    const dueState = makeState({ item_id: "jpv-001", current_easiness: 2.3 });
    const masteredState = makeState({
      item_id: "jpv-099",
      mastery_reached_at: "2026-05-20T12:00:00.000Z",
      presented_count: 5,
      correct_count: 5,
    });
    const allStates = [dueState, masteredState];
    const api = buildApi({
      listBanks: vi.fn().mockResolvedValue({
        banks: [
          {
            bank_id: "ja-pt-vocab-n5",
            title: "JP-PT N5",
            curator: "jun",
            item_count: 50,
            target_personas: [],
          },
        ],
      }),
      listDrillStates: vi.fn().mockResolvedValue({ states: allStates }),
      listDrillDue: vi.fn().mockResolvedValue({ states: [dueState] }),
      listDrillMastered: vi
        .fn()
        .mockResolvedValue({ states: [masteredState] }),
    });
    render(B2DrillingPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("b2-loading")).toBeNull();
    });
    expect(screen.getByTestId("b2-due-block")).toBeDefined();
    expect(screen.getByTestId("b2-mastered-block")).toBeDefined();
    expect(screen.getByTestId("b2-stats-block")).toBeDefined();
    expect(screen.getByText("jpv-001")).toBeDefined();
    expect(screen.getByText("jpv-099")).toBeDefined();
    // avg easiness = (2.3 + 2.5)/2 = 2.4
    expect(screen.getByText("2.40")).toBeDefined();
    // retention = (2 + 5)/(3 + 5) * 100 = 87.5%
    expect(screen.getByText("87.5%")).toBeDefined();
  });

  it("renderiza error state quando API falha", async () => {
    const api = buildApi({
      listBanks: vi.fn().mockRejectedValue(new Error("BFF unreachable")),
    });
    render(B2DrillingPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.getByTestId("b2-error")).toBeDefined();
    });
    expect(screen.getByText(/BFF unreachable/)).toBeDefined();
  });
});
