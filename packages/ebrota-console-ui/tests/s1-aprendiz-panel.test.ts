/**
 * S1AprendizPanel — wiring tests com mock ApiClient.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 *
 * Cobre:
 *  - Render com mock returning objectives + threads + SK summary
 *  - Click no objetivo → fetch history e expande inline
 *  - Loading state visível durante fetch
 *  - Empty states graciosos
 *  - Error fallback pra PlaceholderBanner
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import S1AprendizPanel from "../src/components/subsystem-panels/S1AprendizPanel.svelte";
import {
  currentSessionId,
  tracerSubjectId,
  expandedSubsystem,
} from "../src/lib/stores.js";
import type {
  ApiClient,
  DeclaredObjectiveLike,
  NarrativeThreadLike,
  SubjectKnowledgeSummary,
} from "../src/lib/api.js";

type DeferredFetch<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): DeferredFetch<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const stub = (): never => {
    throw new Error("not stubbed");
  };
  // Cast pra ApiClient — preencho só os métodos usados pelo painel.
  return {
    getStatus: stub,
    getMode: stub,
    setMode: stub,
    startCardSession: stub,
    getActiveSessions: stub,
    listOptions: stub,
    overrideSelection: stub,
    listDecisions: stub,
    getPendingApproval: stub,
    approveOrEdit: stub,
    endSession: stub,
    listSessionLibrary: stub,
    getSessionReplay: stub,
    listDebugLlmCalls: stub,
    clearDebugLlmCalls: stub,
    listAnalyticsPersonas: stub,
    getPersonaEvolution: stub,
    turnStateSseUrl: () => "/api/turn-state",
    listSubjectDiscoveries: stub,
    listSubjectBoundaries: stub,
    getBoundariesSummary: stub,
    getJourneyState: stub,
    setJourneyOverride: stub,
    clearJourneyOverride: stub,
    listFrameworks: stub,
    getSubjectMaps: stub,
    getDeclaredObjectives: async () => ({ objectives: [] }),
    getObjectiveHistory: async () => ({ trail: [] }),
    getNarrativeThreads: async () => ({ threads: [] }),
    getSubjectKnowledge: async () => ({
      conceptsPresentedCount: 0,
      recallPositiveRate: null,
      recallTotal: 0,
      topConcepts: [],
    }),
    getSessionStrategyPlan: stub,
    listSubjectStrategyPlans: stub,
    ...overrides,
  } as ApiClient;
}

const sampleObjective: DeclaredObjectiveLike = {
  id: "obj-1",
  persona_id: "ryo",
  declared_at: "2026-05-20T10:00:00Z",
  declared_in_session: "sess-A",
  target_date: "2026-06-20T10:00:00Z",
  statement: "Ler 5 livros sobre dinossauros",
  axis: "curiosidade",
  status: "active",
};

const sampleThread: NarrativeThreadLike = {
  id: "t-1",
  persona_id: "ryo",
  opened_in_session: "sess-A",
  opened_at: "2026-05-22T10:00:00Z",
  thread_text: "queria fazer origami de baleia",
  axis: "criatividade",
  follow_up_triggered: false,
  status: "open",
  stale_after: "2026-05-29T10:00:00Z",
};

const sampleSummary: SubjectKnowledgeSummary = {
  conceptsPresentedCount: 7,
  recallPositiveRate: 0.6,
  recallTotal: 5,
  topConcepts: [
    {
      concept_id: "estoica/dicotomia_controle",
      lineage_anchor: "estoica/dicotomia_controle",
      presentedCount: 3,
      lastSeenAt: "2026-05-26T10:00:00Z",
    },
  ],
};

beforeEach(() => {
  expandedSubsystem.set("S1");
  currentSessionId.set("ryo__conv-1");
  tracerSubjectId.set("ryo");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("S1AprendizPanel — wiring", () => {
  it("renderiza dados reais (objectives + threads + SK) com mock api", async () => {
    const api = mockApi({
      getDeclaredObjectives: async () => ({ objectives: [sampleObjective] }),
      getNarrativeThreads: async () => ({ threads: [sampleThread] }),
      getSubjectKnowledge: async () => sampleSummary,
    });

    render(S1AprendizPanel, { api });

    await waitFor(() => {
      expect(screen.getByText("Ler 5 livros sobre dinossauros")).toBeDefined();
    });
    expect(screen.getByText("queria fazer origami de baleia")).toBeDefined();
    expect(screen.getByTestId("sk-stats")).toBeDefined();
    expect(screen.getByText("estoica/dicotomia_controle")).toBeDefined();
  });

  it("loading state visível durante fetch", async () => {
    const objectivesDef = deferred<{ objectives: DeclaredObjectiveLike[] }>();
    const threadsDef = deferred<{ threads: NarrativeThreadLike[] }>();
    const skDef = deferred<SubjectKnowledgeSummary>();
    const api = mockApi({
      getDeclaredObjectives: () => objectivesDef.promise,
      getNarrativeThreads: () => threadsDef.promise,
      getSubjectKnowledge: () => skDef.promise,
    });

    render(S1AprendizPanel, { api });

    expect(screen.getByTestId("objectives-loading")).toBeDefined();
    expect(screen.getByTestId("threads-loading")).toBeDefined();
    expect(screen.getByTestId("sk-loading")).toBeDefined();

    objectivesDef.resolve({ objectives: [sampleObjective] });
    threadsDef.resolve({ threads: [] });
    skDef.resolve({
      conceptsPresentedCount: 0,
      recallPositiveRate: null,
      recallTotal: 0,
      topConcepts: [],
    });

    await waitFor(() => {
      expect(screen.getByText("Ler 5 livros sobre dinossauros")).toBeDefined();
    });
  });

  it("click no objetivo expande inline com history trail", async () => {
    const api = mockApi({
      getDeclaredObjectives: async () => ({ objectives: [sampleObjective] }),
      getObjectiveHistory: async () => ({
        trail: [
          { ...sampleObjective, id: "obj-1-v0", statement: "Ler 3 livros", status: "revised" },
          sampleObjective,
        ],
      }),
    });

    render(S1AprendizPanel, { api });

    await waitFor(() => {
      expect(screen.getByTestId("objective-toggle-obj-1")).toBeDefined();
    });
    await fireEvent.click(screen.getByTestId("objective-toggle-obj-1"));

    await waitFor(() => {
      expect(screen.getByTestId("objective-history-obj-1")).toBeDefined();
    });
    expect(screen.getByText("Ler 3 livros")).toBeDefined();
  });

  it("empty state quando persona sem dados", async () => {
    const api = mockApi();
    render(S1AprendizPanel, { api });

    await waitFor(() => {
      expect(screen.getByTestId("objectives-empty")).toBeDefined();
    });
    expect(screen.getByTestId("threads-empty")).toBeDefined();
    expect(screen.getByTestId("sk-empty")).toBeDefined();
  });

  it("error → fallback pra PlaceholderBanner", async () => {
    const api = mockApi({
      getDeclaredObjectives: async () => {
        throw new Error("BFF offline");
      },
      getNarrativeThreads: async () => {
        throw new Error("BFF offline");
      },
      getSubjectKnowledge: async () => {
        throw new Error("BFF offline");
      },
    });

    render(S1AprendizPanel, { api });

    await waitFor(() => {
      expect(screen.getByTestId("objectives-error")).toBeDefined();
    });
    expect(screen.getByTestId("threads-error")).toBeDefined();
    expect(screen.getByTestId("sk-error")).toBeDefined();
    expect(screen.getByText(/2026-05-26-s1-objetivos-declarados-v0\.md/)).toBeDefined();
    expect(screen.getByText(/2026-05-26-b1-hooks-temporais-v0\.md/)).toBeDefined();
  });

  it("deriva persona_id de $currentSessionId (split em __)", async () => {
    currentSessionId.set("yuji__conv-42");
    const captured: string[] = [];
    const api = mockApi({
      getDeclaredObjectives: async (pid) => {
        captured.push(pid);
        return { objectives: [] };
      },
      getNarrativeThreads: async (pid) => {
        captured.push(pid);
        return { threads: [] };
      },
      getSubjectKnowledge: async (pid) => {
        captured.push(pid);
        return {
          conceptsPresentedCount: 0,
          recallPositiveRate: null,
          recallTotal: 0,
          topConcepts: [],
        };
      },
    });

    render(S1AprendizPanel, { api });
    await waitFor(() => {
      expect(captured.length).toBeGreaterThanOrEqual(3);
    });
    expect(captured.every((p) => p === "yuji")).toBe(true);
  });

  it("fallback pro tracerSubjectId quando session vazio", async () => {
    currentSessionId.set(null);
    tracerSubjectId.set("saki-default");
    let pid = "";
    const api = mockApi({
      getDeclaredObjectives: async (p) => {
        pid = p;
        return { objectives: [] };
      },
    });

    render(S1AprendizPanel, { api });
    await waitFor(() => {
      expect(pid).toBe("saki-default");
    });
  });
});
