import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import SessionLibrary from "../../src/components/SessionLibrary.svelte";
import {
  libraryOpen,
  replaySessionId,
} from "../../src/lib/stores.js";
import type {
  ApiClient,
  SessionLibraryEntry,
} from "../../src/lib/api.js";

const sampleEntry = (
  overrides: Partial<SessionLibraryEntry> = {},
): SessionLibraryEntry => ({
  sessionId: "yuji__a",
  personaId: "yuji",
  conversationId: "a",
  kind: "real",
  startedAt: "2026-05-24T13:00:00.000Z",
  endedAt: null,
  turnCount: 3,
  hasOverrides: false,
  tracePath: "/tmp/trace.json",
  ...overrides,
});

const buildApi = (
  listResponse: SessionLibraryEntry[] = [],
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
    listSessionLibrary: vi.fn(async () => ({ sessions: listResponse })),
    getSessionReplay: vi.fn(),
    turnStateSseUrl: () => "/api/sse",
  }) as never;

beforeEach(() => {
  libraryOpen.set(true);
  replaySessionId.set(null);
});

describe("SessionLibrary.svelte", () => {
  it("não renderiza quando libraryOpen=false", () => {
    libraryOpen.set(false);
    render(SessionLibrary, { api: buildApi() });
    expect(screen.queryByTestId("session-library")).toBeNull();
  });

  it("renderiza quando libraryOpen=true", async () => {
    render(SessionLibrary, { api: buildApi([sampleEntry()]) });
    await waitFor(() => {
      expect(screen.getByTestId("library-entry")).toBeDefined();
    });
    // Após entry carregar, verifica content
    const entry = screen.getByTestId("library-entry");
    expect(entry.textContent).toContain("yuji");
  });

  it("close button seta libraryOpen=false", async () => {
    render(SessionLibrary, { api: buildApi() });
    await waitFor(() =>
      expect(screen.getByTestId("session-library")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("library-close"));
    expect(get(libraryOpen)).toBe(false);
  });

  it("filter persona dispara refresh com filters", async () => {
    const list = vi.fn(async () => ({
      sessions: [sampleEntry({ personaId: "kei" })],
    }));
    const api = buildApi();
    (api as unknown as { listSessionLibrary: typeof list }).listSessionLibrary =
      list;
    render(SessionLibrary, { api });
    await waitFor(() =>
      expect(screen.getByTestId("filter-persona")).toBeDefined(),
    );
    const input = screen.getByTestId(
      "filter-persona",
    ) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "kei" } });
    await fireEvent.click(screen.getByTestId("filter-apply"));
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ persona: "kei" }),
    );
  });

  it("filter clear reseta inputs", async () => {
    render(SessionLibrary, { api: buildApi() });
    await waitFor(() =>
      expect(screen.getByTestId("filter-clear")).toBeDefined(),
    );
    const input = screen.getByTestId(
      "filter-persona",
    ) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "yuji" } });
    expect(input.value).toBe("yuji");
    await fireEvent.click(screen.getByTestId("filter-clear"));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(input.value).toBe("");
  });

  it("entry click seta replaySessionId", async () => {
    render(SessionLibrary, {
      api: buildApi([sampleEntry({ sessionId: "yuji__click-test" })]),
    });
    await waitFor(() =>
      expect(screen.getByTestId("library-entry")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("library-entry"));
    expect(get(replaySessionId)).toBe("yuji__click-test");
  });

  it("badge 'overrides' renderiza pra sessões com hasOverrides", async () => {
    render(SessionLibrary, {
      api: buildApi([sampleEntry({ hasOverrides: true })]),
    });
    await waitFor(() =>
      expect(screen.getByText("overrides")).toBeDefined(),
    );
  });

  it("estado vazio mostra 'Nenhuma sessão'", async () => {
    render(SessionLibrary, { api: buildApi([]) });
    await waitFor(() => {
      expect(screen.getByText(/Nenhuma sessão/)).toBeDefined();
    });
  });
});
