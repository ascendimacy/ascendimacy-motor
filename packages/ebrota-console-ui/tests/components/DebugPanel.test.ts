import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import DebugPanel from "../../src/components/DebugPanel.svelte";
import {
  debugLlmEvents,
  debugPanelOpen,
} from "../../src/lib/stores.js";
import type { ApiClient, DebugLlmCallEvent } from "../../src/lib/api.js";

const sampleEvent = (
  overrides: Partial<DebugLlmCallEvent> = {},
): DebugLlmCallEvent => ({
  id: 1,
  receivedAt: "2026-05-24T13:00:00.000Z",
  step: "planejador.plan_turn",
  provider: "anthropic",
  model: "claude-opus-4",
  prompt: {
    system: "You are Brota...",
    user: "card:tabuada-7",
  },
  params: { temperature: 0.7 },
  sessionId: "yuji__a",
  turn: 0,
  ...overrides,
});

const buildApi = (
  events: DebugLlmCallEvent[] = [],
  totalEmitted = events.length,
): ApiClient =>
  ({
    getStatus: vi.fn(),
    getMode: vi.fn(),
    setMode: vi.fn(),
    startCardSession: vi.fn(),
    listOptions: vi.fn(),
    overrideSelection: vi.fn(),
    listDecisions: vi.fn(),
    getPendingApproval: vi.fn(),
    approveOrEdit: vi.fn(),
    endSession: vi.fn(),
    listSessionLibrary: vi.fn(),
    getSessionReplay: vi.fn(),
    listDebugLlmCalls: vi.fn(async () => ({ events, totalEmitted })),
    clearDebugLlmCalls: vi.fn(async () => ({ cleared: true })),
    turnStateSseUrl: () => "/api/sse",
  }) as never;

const NO_POLLING = 999_999;

beforeEach(() => {
  debugPanelOpen.set(true);
  debugLlmEvents.set([]);
});

describe("DebugPanel.svelte — visibility", () => {
  it("não renderiza quando debugPanelOpen=false", () => {
    debugPanelOpen.set(false);
    render(DebugPanel, { api: buildApi(), pollIntervalMs: NO_POLLING });
    expect(screen.queryByTestId("debug-panel")).toBeNull();
  });

  it("renderiza header + tail badge quando open", () => {
    render(DebugPanel, { api: buildApi(), pollIntervalMs: NO_POLLING });
    expect(screen.getByTestId("debug-panel")).toBeDefined();
    expect(screen.getByText("tail")).toBeDefined();
  });

  it("close button seta debugPanelOpen=false", async () => {
    render(DebugPanel, { api: buildApi(), pollIntervalMs: NO_POLLING });
    await fireEvent.click(screen.getByTestId("debug-close"));
    expect(get(debugPanelOpen)).toBe(false);
  });
});

describe("DebugPanel.svelte — events display", () => {
  it("estado vazio mostra hint sobre ASC_LLM_DEBUG_MODE", () => {
    render(DebugPanel, { api: buildApi([]), pollIntervalMs: NO_POLLING });
    expect(screen.getByTestId("debug-empty")).toBeDefined();
  });

  it("renderiza eventos populados via store", async () => {
    debugLlmEvents.set([sampleEvent()]);
    render(DebugPanel, { api: buildApi(), pollIntervalMs: NO_POLLING });
    await waitFor(() => {
      expect(screen.getByTestId("debug-event")).toBeDefined();
    });
    expect(screen.getByText("anthropic")).toBeDefined();
    expect(screen.getByText("claude-opus-4")).toBeDefined();
    expect(screen.getByText("planejador.plan_turn")).toBeDefined();
  });

  it("expand toggle revela prompt body", async () => {
    debugLlmEvents.set([sampleEvent()]);
    render(DebugPanel, { api: buildApi(), pollIntervalMs: NO_POLLING });
    await waitFor(() =>
      expect(screen.getByTestId("debug-event-toggle")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("debug-event-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("debug-event-body")).toBeDefined(),
    );
    expect(screen.getByText("You are Brota...")).toBeDefined();
  });

  it("provider classes aplicadas (anthropic/infomaniak/local/unknown)", async () => {
    debugLlmEvents.set([
      sampleEvent({ id: 1, provider: "anthropic" }),
      sampleEvent({ id: 2, provider: "infomaniak" }),
      sampleEvent({ id: 3, provider: "local" }),
      sampleEvent({ id: 4, provider: "unknown" }),
    ]);
    render(DebugPanel, { api: buildApi(), pollIntervalMs: NO_POLLING });
    await waitFor(() => {
      const events = screen.getAllByTestId("debug-event");
      expect(events).toHaveLength(4);
    });
    const providers = screen.getAllByText(/anthropic|infomaniak|local|unknown/);
    // 4 spans .provider matching
    expect(providers.length).toBeGreaterThanOrEqual(4);
  });

  it("clear button chama api.clearDebugLlmCalls + reset store", async () => {
    debugLlmEvents.set([sampleEvent(), sampleEvent({ id: 2 })]);
    const clearFn = vi.fn(async () => ({ cleared: true }));
    const api = buildApi();
    (api as unknown as { clearDebugLlmCalls: typeof clearFn }).clearDebugLlmCalls =
      clearFn;
    render(DebugPanel, { api, pollIntervalMs: NO_POLLING });
    await waitFor(() =>
      expect(screen.getByTestId("debug-clear")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("debug-clear"));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(clearFn).toHaveBeenCalled();
    expect(get(debugLlmEvents)).toEqual([]);
  });

  it("total emitted mostrado", async () => {
    debugLlmEvents.set([sampleEvent()]);
    const api = buildApi([sampleEvent({ id: 999 })], 999);
    render(DebugPanel, { api, pollIntervalMs: 30 });
    await waitFor(() => {
      expect(screen.getByTestId("debug-total").textContent).toMatch(/999/);
    });
  });
});

describe("DebugPanel.svelte — polling", () => {
  it("polling busca novos events e append ao store", async () => {
    let counter = 0;
    const list = vi.fn(async (sinceId?: number) => {
      counter++;
      if (counter === 1) {
        return { events: [sampleEvent({ id: 1 })], totalEmitted: 1 };
      }
      if (counter === 2 && (sinceId ?? 0) < 2) {
        return { events: [sampleEvent({ id: 2 })], totalEmitted: 2 };
      }
      return { events: [], totalEmitted: 2 };
    });
    const api = buildApi();
    (api as unknown as { listDebugLlmCalls: typeof list }).listDebugLlmCalls =
      list;
    render(DebugPanel, { api, pollIntervalMs: 30 });
    await waitFor(() => expect(list).toHaveBeenCalled());
    await new Promise<void>((r) => setTimeout(r, 80));
    expect(get(debugLlmEvents).length).toBeGreaterThanOrEqual(1);
  });
});
