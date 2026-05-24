import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import SessionStart from "../../src/components/SessionStart.svelte";
import {
  chatBubbles,
  currentSessionId,
  globalError,
} from "../../src/lib/stores.js";
import type { ApiClient } from "../../src/lib/api.js";

const buildApiMock = (
  startCardSessionFn: ApiClient["startCardSession"],
): ApiClient =>
  ({
    getStatus: vi.fn(),
    getMode: vi.fn(),
    setMode: vi.fn(),
    startCardSession: startCardSessionFn,
    listOptions: vi.fn(),
    overrideSelection: vi.fn(),
    getPendingApproval: vi.fn(),
    approveOrEdit: vi.fn(),
    endSession: vi.fn(),
    turnStateSseUrl: () => "/api/sse",
  }) as never;

beforeEach(() => {
  chatBubbles.set([]);
  currentSessionId.set(null);
  globalError.set(null);
});

describe("SessionStart.svelte", () => {
  it("renderiza form com defaults preenchidos", () => {
    const api = buildApiMock(vi.fn());
    render(SessionStart, { api });
    expect(
      (screen.getByTestId("card-id-input") as HTMLInputElement).value,
    ).toBe("tabuada-7");
    expect(
      (screen.getByTestId("from-input") as HTMLInputElement).value,
    ).toBe("yuji");
  });

  it("click Iniciar dispara api.startCardSession + popula chat bubbles", async () => {
    const start = vi.fn(async () => ({
      sessionId: "yuji__yuji-12345",
      text: "Vamos descobrir tabuada!",
      tracePath: "/tmp/trace.json",
    }));
    const api = buildApiMock(start);
    render(SessionStart, { api });
    await fireEvent.click(screen.getByTestId("start-button"));
    // Aguarda promise resolver
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(start).toHaveBeenCalledTimes(1);
    expect(get(currentSessionId)).toBe("yuji__yuji-12345");
    const bubbles = get(chatBubbles);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]!.role).toBe("user");
    expect(bubbles[0]!.text).toBe("card:tabuada-7");
    expect(bubbles[1]!.role).toBe("bot");
    expect(bubbles[1]!.text).toBe("Vamos descobrir tabuada!");
  });

  it("globalError populado quando startCardSession falha", async () => {
    const start = vi.fn(async () => {
      throw new Error("BFF offline");
    });
    const api = buildApiMock(start);
    render(SessionStart, { api });
    await fireEvent.click(screen.getByTestId("start-button"));
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(get(globalError)).toContain("BFF offline");
    expect(get(currentSessionId)).toBeNull();
  });

  it("button disabled quando cardId vazio", async () => {
    const api = buildApiMock(vi.fn());
    const { container } = render(SessionStart, { api });
    const input = screen.getByTestId("card-id-input") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "" } });
    const btn = container.querySelector(
      '[data-testid="start-button"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
