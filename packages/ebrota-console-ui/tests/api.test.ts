import { describe, it, expect, vi } from "vitest";
import { createApiClient } from "../src/lib/api.js";
import type { BffStatus } from "../src/lib/types.js";

const buildFetchMock = (responses: Record<string, unknown>) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^\/api/, "");
    const method = init?.method ?? "GET";
    const key = `${method} ${path}`;
    if (!(key in responses)) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: `unexpected: ${key}` }),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => responses[key],
    };
  });

describe("createApiClient", () => {
  it("getStatus chama GET /status", async () => {
    const status: BffStatus = {
      mode: "auto",
      daemonConnected: true,
      channelConnected: true,
      sessionCount: 0,
      startedAt: "now",
    };
    const fetchMock = buildFetchMock({ "GET /status": status });
    const api = createApiClient({ fetch: fetchMock as never });
    const result = await api.getStatus();
    expect(result).toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith("/api/status");
  });

  it("setMode chama POST /mode com body", async () => {
    const fetchMock = buildFetchMock({
      "POST /mode": { mode: "semi-auto" },
    });
    const api = createApiClient({ fetch: fetchMock as never });
    const result = await api.setMode("semi-auto");
    expect(result.mode).toBe("semi-auto");
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("/api/mode");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      mode: "semi-auto",
    });
  });

  it("startCardSession chama POST /sessions/start-card", async () => {
    const fetchMock = buildFetchMock({
      "POST /sessions/start-card": {
        sessionId: "s1",
        text: "mock",
        tracePath: "/t",
      },
    });
    const api = createApiClient({ fetch: fetchMock as never });
    const result = await api.startCardSession({
      cardId: "x",
      conversationId: "c",
      from: "f",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
    });
    expect(result.sessionId).toBe("s1");
  });

  it("overrideSelection encoda sessionId na URL", async () => {
    const fetchMock = buildFetchMock({
      "POST /sessions/s%20id/override": {
        accepted: true,
        foundInPool: true,
        gateWasActive: true,
      },
    });
    const api = createApiClient({ fetch: fetchMock as never });
    await api.overrideSelection("s id", "card-a");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/s%20id/override",
      expect.anything(),
    );
  });

  it("turnStateSseUrl retorna URL completa", () => {
    const api = createApiClient({ baseUrl: "/api" });
    expect(api.turnStateSseUrl("sess-1")).toBe(
      "/api/sessions/sess-1/turn-state",
    );
  });

  it("throw em response não-ok", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    }));
    const api = createApiClient({ fetch: fetchMock as never });
    await expect(api.getStatus()).rejects.toThrow(/BFF GET/);
  });

  it("custom baseUrl é respeitado", async () => {
    const fetchMock = buildFetchMock({});
    const api = createApiClient({
      baseUrl: "https://example.com/bff",
      fetch: fetchMock as never,
    });
    api.turnStateSseUrl("s1");
    expect(api.turnStateSseUrl("s1")).toBe(
      "https://example.com/bff/sessions/s1/turn-state",
    );
  });
});
