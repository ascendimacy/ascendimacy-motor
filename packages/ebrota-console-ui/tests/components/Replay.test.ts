import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import Replay from "../../src/components/Replay.svelte";
import { replaySessionId } from "../../src/lib/stores.js";
import type { ApiClient, ReplayTrace } from "../../src/lib/api.js";

const buildApi = (trace: ReplayTrace | (() => never)): ApiClient =>
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
    getSessionReplay: vi.fn(async () =>
      typeof trace === "function" ? trace() : trace,
    ),
    turnStateSseUrl: () => "/api/sse",
  }) as never;

beforeEach(() => {
  replaySessionId.set(null);
});

describe("Replay.svelte", () => {
  it("não renderiza quando replaySessionId=null", () => {
    render(Replay, { api: buildApi({ sessionId: "x" }) });
    expect(screen.queryByTestId("replay-overlay")).toBeNull();
  });

  it("renderiza modal quando replaySessionId set + fetch resolve", async () => {
    const trace: ReplayTrace = {
      sessionId: "yuji__a",
      persona: "yuji",
      startedAt: "2026-05-24T13:00:00.000Z",
      turns: [
        {
          turnNumber: 0,
          incomingMessage: "card:tabuada-7",
          finalResponse: "Vamos descobrir!",
          timestamp: "2026-05-24T13:00:01.000Z",
        },
        {
          turnNumber: 1,
          incomingMessage: "deu certo?",
          finalResponse: "Sim!",
          timestamp: "2026-05-24T13:00:30.000Z",
        },
      ],
    };
    render(Replay, { api: buildApi(trace) });
    replaySessionId.set("yuji__a");
    await waitFor(() => {
      expect(screen.getByTestId("replay-modal")).toBeDefined();
    });
    expect(screen.getByText("card:tabuada-7")).toBeDefined();
    expect(screen.getByText("Vamos descobrir!")).toBeDefined();
    expect(screen.getByText("deu certo?")).toBeDefined();
    expect(screen.getAllByTestId("replay-turn").length).toBe(2);
  });

  it("close button reseta replaySessionId", async () => {
    render(Replay, {
      api: buildApi({ sessionId: "x", turns: [] }),
    });
    replaySessionId.set("x");
    await waitFor(() =>
      expect(screen.getByTestId("replay-close")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("replay-close"));
    expect(get(replaySessionId)).toBeNull();
  });

  it("backdrop click fecha modal (click no overlay self)", async () => {
    render(Replay, {
      api: buildApi({ sessionId: "x", turns: [] }),
    });
    replaySessionId.set("x");
    const overlay = await waitFor(() =>
      screen.getByTestId("replay-overlay"),
    );
    await fireEvent.click(overlay);
    expect(get(replaySessionId)).toBeNull();
  });

  it("Escape fecha modal", async () => {
    render(Replay, {
      api: buildApi({ sessionId: "x", turns: [] }),
    });
    replaySessionId.set("x");
    const overlay = await waitFor(() =>
      screen.getByTestId("replay-overlay"),
    );
    await fireEvent.keyDown(overlay, { key: "Escape" });
    expect(get(replaySessionId)).toBeNull();
  });

  it("trace sem turns mostra 'Nenhum turn registrado'", async () => {
    render(Replay, {
      api: buildApi({ sessionId: "x", persona: "yuji", turns: [] }),
    });
    replaySessionId.set("x");
    await waitFor(() => {
      expect(screen.getByText(/Nenhum turn registrado/)).toBeDefined();
    });
  });

  it("muda sessionId → faz nova fetch", async () => {
    const getReplay = vi.fn(async (id: string) => ({
      sessionId: id,
      turns: [],
    }));
    const api = {
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
      getSessionReplay: getReplay,
      turnStateSseUrl: () => "/api/sse",
    } as never;
    render(Replay, { api });
    replaySessionId.set("s1");
    await waitFor(() => expect(getReplay).toHaveBeenCalledWith("s1"));
    replaySessionId.set("s2");
    await waitFor(() => expect(getReplay).toHaveBeenCalledWith("s2"));
    expect(getReplay).toHaveBeenCalledTimes(2);
  });
});
