import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import Status from "../../src/components/Status.svelte";
import { bffStatus, consoleMode } from "../../src/lib/stores.js";
import type { ApiClient } from "../../src/lib/api.js";
import type { BffStatus, ConsoleMode } from "../../src/lib/types.js";

const buildApiMock = (
  setModeFn: (mode: ConsoleMode) => Promise<{ mode: ConsoleMode }>,
): ApiClient =>
  ({
    getStatus: vi.fn(),
    getMode: vi.fn(),
    setMode: setModeFn,
    startCardSession: vi.fn(),
    listOptions: vi.fn(),
    overrideSelection: vi.fn(),
    getPendingApproval: vi.fn(),
    approveOrEdit: vi.fn(),
    endSession: vi.fn(),
    turnStateSseUrl: () => "/api/sse",
  }) as never;

describe("Status.svelte", () => {
  it("renderiza brand + version", () => {
    consoleMode.set("auto");
    bffStatus.set(null);
    const api = buildApiMock(async (m) => ({ mode: m }));
    render(Status, { api });
    expect(
      screen.getByRole("heading", { name: /eBrota Console/i }),
    ).toBeDefined();
    expect(screen.getByText(/v0\.1\.0/)).toBeDefined();
  });

  it("indicadores daemon/channel reflectem bffStatus", () => {
    consoleMode.set("auto");
    const status: BffStatus = {
      mode: "auto",
      daemonConnected: true,
      channelConnected: false,
      sessionCount: 3,
      startedAt: "2026-05-24T12:00:00.000Z",
    };
    bffStatus.set(status);
    const api = buildApiMock(async (m) => ({ mode: m }));
    render(Status, { api });
    const daemon = screen.getByTestId("daemon-indicator");
    const channel = screen.getByTestId("channel-indicator");
    expect(daemon.classList.contains("on")).toBe(true);
    expect(channel.classList.contains("on")).toBe(false);
    expect(screen.getByTestId("session-count").textContent).toContain("3");
  });

  it("mode toggle button dispara api.setMode + atualiza store", async () => {
    consoleMode.set("auto");
    bffStatus.set(null);
    const setMode = vi.fn(async (m: ConsoleMode) => ({ mode: m }));
    const api = buildApiMock(setMode);
    render(Status, { api });
    const btn = screen.getByTestId("mode-toggle");
    await fireEvent.click(btn);
    expect(setMode).toHaveBeenCalledWith("semi-auto");
    expect(get(consoleMode)).toBe("semi-auto");
  });

  it("button mostra 'auto' por default e 'semi-auto' após toggle", async () => {
    consoleMode.set("auto");
    bffStatus.set(null);
    const api = buildApiMock(async (m) => ({ mode: m }));
    render(Status, { api });
    const btn = screen.getByTestId("mode-toggle");
    expect(btn.textContent).toContain("auto");
    await fireEvent.click(btn);
    // Reactivity wait
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(btn.textContent).toContain("semi-auto");
  });
});
