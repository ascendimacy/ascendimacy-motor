import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import Analytics from "../../src/components/Analytics.svelte";
import {
  analyticsOpen,
  replaySessionId,
} from "../../src/lib/stores.js";
import type {
  ApiClient,
  PersonaEvolution,
  PersonaSummary,
} from "../../src/lib/api.js";

const yujiSummary = (): PersonaSummary => ({
  personaId: "yuji",
  sessionCount: 5,
  realCount: 2,
  stsCount: 3,
  totalTurns: 42,
  totalOverrides: 3,
  overrideRate: 0.071,
  firstSessionAt: "2026-05-01T10:00:00.000Z",
  lastSessionAt: "2026-05-23T15:00:00.000Z",
});

const keiSummary = (): PersonaSummary => ({
  personaId: "kei",
  sessionCount: 1,
  realCount: 1,
  stsCount: 0,
  totalTurns: 6,
  totalOverrides: 2,
  overrideRate: 0.333,
  firstSessionAt: "2026-05-20T10:00:00.000Z",
  lastSessionAt: "2026-05-20T10:00:00.000Z",
});

const yujiEvolution = (): PersonaEvolution => ({
  personaId: "yuji",
  summary: yujiSummary(),
  sessions: [
    {
      sessionId: "yuji__a",
      startedAt: "2026-05-01T10:00:00.000Z",
      kind: "real",
      turnCount: 8,
      hasOverrides: false,
      overrideCount: 0,
    },
    {
      sessionId: "yuji__b",
      startedAt: "2026-05-15T10:00:00.000Z",
      kind: "sts",
      turnCount: 12,
      hasOverrides: true,
      overrideCount: 2,
    },
    {
      sessionId: "yuji__c",
      startedAt: "2026-05-23T15:00:00.000Z",
      kind: "real",
      turnCount: 6,
      hasOverrides: false,
      overrideCount: 0,
    },
  ],
});

const buildApi = (
  personas: PersonaSummary[] = [],
  evolution: PersonaEvolution | null = null,
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
    listDebugLlmCalls: vi.fn(),
    clearDebugLlmCalls: vi.fn(),
    listAnalyticsPersonas: vi.fn(async () => ({ personas })),
    getPersonaEvolution: vi.fn(async () => {
      if (evolution === null) throw new Error("not found");
      return evolution;
    }),
    turnStateSseUrl: () => "/api/sse",
  }) as never;

beforeEach(() => {
  analyticsOpen.set(true);
  replaySessionId.set(null);
});

describe("Analytics.svelte — visibility", () => {
  it("não renderiza quando analyticsOpen=false", () => {
    analyticsOpen.set(false);
    render(Analytics, { api: buildApi() });
    expect(screen.queryByTestId("analytics-panel")).toBeNull();
  });

  it("close button fecha o panel", async () => {
    render(Analytics, { api: buildApi() });
    await fireEvent.click(screen.getByTestId("analytics-close"));
    expect(get(analyticsOpen)).toBe(false);
  });
});

describe("Analytics.svelte — personas list", () => {
  it("estado vazio renderiza hint", async () => {
    render(Analytics, { api: buildApi([]) });
    await waitFor(() =>
      expect(screen.getByTestId("analytics-empty")).toBeDefined(),
    );
  });

  it("cards de persona renderizados com stats", async () => {
    render(Analytics, { api: buildApi([yujiSummary(), keiSummary()]) });
    await waitFor(() => {
      const cards = screen.getAllByTestId("persona-card");
      expect(cards).toHaveLength(2);
    });
    expect(screen.getByText("yuji")).toBeDefined();
    expect(screen.getByText("kei")).toBeDefined();
    // totalTurns visible
    expect(screen.getByText("42")).toBeDefined();
  });

  it("override rate warn class quando >20%", async () => {
    render(Analytics, { api: buildApi([keiSummary()]) });
    await waitFor(() => {
      const rate = screen.getAllByTestId("override-rate")[0];
      expect(rate?.className).toMatch(/warn/);
    });
  });
});

describe("Analytics.svelte — drill-down", () => {
  it("click em persona card abre evolution view", async () => {
    render(Analytics, {
      api: buildApi([yujiSummary()], yujiEvolution()),
    });
    await waitFor(() =>
      expect(screen.getByTestId("persona-card")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("persona-card"));
    await waitFor(() =>
      expect(screen.getByTestId("evolution-view")).toBeDefined(),
    );
    expect(screen.getByTestId("evolution-summary")).toBeDefined();
  });

  it("timeline lista session rows", async () => {
    render(Analytics, {
      api: buildApi([yujiSummary()], yujiEvolution()),
    });
    await waitFor(() =>
      expect(screen.getByTestId("persona-card")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("persona-card"));
    await waitFor(() => {
      const rows = screen.getAllByTestId("session-row");
      expect(rows).toHaveLength(3);
    });
  });

  it("filtro kind=sts mostra só sts sessions", async () => {
    render(Analytics, {
      api: buildApi([yujiSummary()], yujiEvolution()),
    });
    await waitFor(() =>
      expect(screen.getByTestId("persona-card")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("persona-card"));
    await waitFor(() =>
      expect(screen.getByTestId("filter-kind")).toBeDefined(),
    );
    const select = screen.getByTestId("filter-kind") as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "sts" } });
    await waitFor(() => {
      const rows = screen.getAllByTestId("session-row");
      expect(rows).toHaveLength(1);
    });
  });

  it("filtro só-overrides mostra apenas com overrides", async () => {
    render(Analytics, {
      api: buildApi([yujiSummary()], yujiEvolution()),
    });
    await waitFor(() =>
      expect(screen.getByTestId("persona-card")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("persona-card"));
    await waitFor(() =>
      expect(screen.getByTestId("filter-overrides")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("filter-overrides"));
    await waitFor(() => {
      const rows = screen.getAllByTestId("session-row");
      expect(rows).toHaveLength(1);
    });
  });

  it("back button retorna pra lista de personas", async () => {
    render(Analytics, {
      api: buildApi([yujiSummary()], yujiEvolution()),
    });
    await waitFor(() =>
      expect(screen.getByTestId("persona-card")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("persona-card"));
    await waitFor(() =>
      expect(screen.getByTestId("analytics-back")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("analytics-back"));
    await waitFor(() =>
      expect(screen.getByTestId("personas-list")).toBeDefined(),
    );
  });

  it("replay button seta replaySessionId + fecha panel", async () => {
    render(Analytics, {
      api: buildApi([yujiSummary()], yujiEvolution()),
    });
    await waitFor(() =>
      expect(screen.getByTestId("persona-card")).toBeDefined(),
    );
    await fireEvent.click(screen.getByTestId("persona-card"));
    await waitFor(() =>
      expect(screen.getAllByTestId("open-replay")).toBeDefined(),
    );
    const buttons = screen.getAllByTestId("open-replay");
    await fireEvent.click(buttons[0]!);
    expect(get(replaySessionId)).toBe("yuji__a");
    expect(get(analyticsOpen)).toBe(false);
  });
});
