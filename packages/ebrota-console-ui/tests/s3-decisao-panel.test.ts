/**
 * S3DecisaoPanel — wiring tests com mock ApiClient.
 *
 * Cobre:
 *  - loading state
 *  - 3 sub-blocks rendered (history, histogram, stats)
 *  - empty state quando persona sem decisões
 *  - histogram width % via inline style
 *  - row expand on click
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import S3DecisaoPanel from "../src/components/subsystem-panels/S3DecisaoPanel.svelte";
import {
  currentSessionId,
  tracerSubjectId,
  expandedSubsystem,
} from "../src/lib/stores.js";
import type {
  ApiClient,
  DecisionRowLike,
  DecisionStatsLike,
  JogadaDistributionLike,
} from "../src/lib/api.js";

function mockApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const stub = (): never => {
    throw new Error("not stubbed");
  };
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
    getDeclaredObjectives: stub,
    getObjectiveHistory: stub,
    getNarrativeThreads: stub,
    getSubjectKnowledge: stub,
    getSessionStrategyPlan: stub,
    listSubjectStrategyPlans: stub,
    getDecisionHistory: async () => ({ personaId: "ryo", decisions: [] }),
    getJogadaDistribution: async () => ({
      personaId: "ryo",
      totalDecisions: 0,
      byJogada: {
        bridge: 0,
        espelho: 0,
        canal: 0,
        diamante: 0,
        arena: 0,
        recovery: 0,
      },
      byMethod: { rule: 0, llm: 0, fallback: 0 },
      byRegister: {},
      developmentStub: true,
    }),
    getDecisionStats: async () => ({
      personaId: "ryo",
      totalTurns: 0,
      cacheHitRate: 0,
      fallbackRate: 0,
      avgPoolSize: 0,
      avgTopScore: 0,
      selectorEscalations: 0,
    }),
    getGuardrailHistory: stub,
    getRecallCheckHistory: stub,
    getTriggerEvents: stub,
    getKpiLongitudinal: stub,
    listStsScenarios: stub,
    listStsPersonas: stub,
    listStsRuns: stub,
    startStsRun: stub,
    getTemporalWindows: stub,
    listPulsoEvents: stub,
    getSacrificeBudget: stub,
    listEmittedCards: stub,
    getDyad: stub,
    listBanks: stub,
    getBank: stub,
    listDrillStates: stub,
    listDrillDue: stub,
    listDrillMastered: stub,
    listDrillAttempts: stub,
    getParentalDashboard: stub,
    getParentalToday: stub,
    getParentalWeek: stub,
    getParentalCards: stub,
    getParentalConversations: stub,
    getParentalAlerts: stub,
    getParentalPulsoEvents: stub,
    listPendingQuestions: stub,
    answerPendingQuestion: stub,
    reportProblem: stub,
    pauseChild: stub,
    getMc1Status: stub,
    cancelMc1: stub,
    ...overrides,
  } as ApiClient;
}

const sampleRow: DecisionRowLike = {
  turnRef: "ryo__sess1__turn_3",
  decidedAt: "2026-05-25T10:10:00Z",
  decisionPath: "tactician_split",
  selectedItemId: "card.bridge.story",
  selectedItemType: "card_catalog",
  selectedScore: 0.91,
  poolSize: 14,
  topNScores: [0.91, 0.72, 0.61],
  tacticDecision: {
    jogada: "bridge",
    angle: "narrar caminho",
    register: "lúdico",
    method: "llm",
  },
  cacheHit: false,
  skipReason: null,
};

const sampleDist: JogadaDistributionLike = {
  personaId: "ryo",
  totalDecisions: 4,
  byJogada: {
    bridge: 2,
    espelho: 1,
    canal: 0,
    diamante: 0,
    arena: 0,
    recovery: 1,
  },
  byMethod: { rule: 2, llm: 1, fallback: 1 },
  byRegister: { lúdico: 2, neutro: 1, acolhedor: 1 },
  developmentStub: false,
};

const sampleStats: DecisionStatsLike = {
  personaId: "ryo",
  totalTurns: 5,
  cacheHitRate: 0.2,
  fallbackRate: 0.2,
  avgPoolSize: 9.8,
  avgTopScore: 0.768,
  selectorEscalations: 1,
};

beforeEach(() => {
  expandedSubsystem.set("S3");
  currentSessionId.set("ryo__conv-1");
  tracerSubjectId.set("ryo");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("S3DecisaoPanel", () => {
  it("renderiza 3 sub-blocks (history, histogram, stats)", async () => {
    const api = mockApi({
      getDecisionHistory: async () => ({ personaId: "ryo", decisions: [sampleRow] }),
      getJogadaDistribution: async () => sampleDist,
      getDecisionStats: async () => sampleStats,
    });
    render(S3DecisaoPanel, { api });
    await waitFor(() => {
      expect(screen.getByTestId("s3-history")).toBeDefined();
      expect(screen.getByTestId("s3-histogram")).toBeDefined();
      expect(screen.getByTestId("s3-stats")).toBeDefined();
    });
  });

  it("mostra loading antes de resolver", async () => {
    let resolveHistory: (v: { personaId: string; decisions: DecisionRowLike[] }) => void = () => {};
    const api = mockApi({
      getDecisionHistory: () =>
        new Promise((res) => {
          resolveHistory = res;
        }),
    });
    render(S3DecisaoPanel, { api });
    await waitFor(() => {
      expect(screen.getByTestId("s3-history-loading")).toBeDefined();
    });
    resolveHistory({ personaId: "ryo", decisions: [] });
  });

  it("empty state quando persona sem decisões", async () => {
    const api = mockApi();
    render(S3DecisaoPanel, { api });
    await waitFor(() => {
      const empty = screen.getByTestId("s3-history-empty");
      expect(empty.textContent).toContain("Persona ainda não tem decisões");
    });
  });

  it("histogram renderiza com width % via inline style", async () => {
    const api = mockApi({
      getJogadaDistribution: async () => sampleDist,
    });
    render(S3DecisaoPanel, { api });
    await waitFor(() => {
      expect(screen.getByTestId("s3-bar-bridge")).toBeDefined();
    });
    const bridgeBar = screen.getByTestId("s3-bar-bridge");
    const fill = bridgeBar.querySelector(".bar-fill") as HTMLElement | null;
    expect(fill).not.toBeNull();
    // bridge=2, max=2 → 100%
    expect(fill!.style.width).toBe("100%");
    const espelhoBar = screen.getByTestId("s3-bar-espelho");
    const espelhoFill = espelhoBar.querySelector(".bar-fill") as HTMLElement;
    // espelho=1, max=2 → 50%
    expect(espelhoFill.style.width).toBe("50%");
    const canalBar = screen.getByTestId("s3-bar-canal");
    const canalFill = canalBar.querySelector(".bar-fill") as HTMLElement;
    expect(canalFill.style.width).toBe("0%");
  });

  it("histogram renderiza todas as 6 chaves de jogada", async () => {
    const api = mockApi({
      getJogadaDistribution: async () => sampleDist,
    });
    render(S3DecisaoPanel, { api });
    await waitFor(() => {
      expect(screen.getByTestId("s3-bar-bridge")).toBeDefined();
    });
    for (const name of ["bridge", "espelho", "canal", "diamante", "arena", "recovery"]) {
      expect(screen.getByTestId(`s3-bar-${name}`)).toBeDefined();
    }
  });

  it("click em row expande detalhe", async () => {
    const api = mockApi({
      getDecisionHistory: async () => ({ personaId: "ryo", decisions: [sampleRow] }),
    });
    render(S3DecisaoPanel, { api });
    await waitFor(() => {
      expect(screen.getByTestId("s3-history-row")).toBeDefined();
    });
    expect(screen.queryByTestId("s3-history-detail")).toBeNull();
    await fireEvent.click(screen.getByTestId("s3-history-row"));
    await waitFor(() => {
      expect(screen.getByTestId("s3-history-detail")).toBeDefined();
    });
    const detail = screen.getByTestId("s3-history-detail");
    expect(detail.textContent).toContain("tactician_split");
    expect(detail.textContent).toContain("narrar caminho");
  });

  it("stats card mostra valores formatados", async () => {
    const api = mockApi({
      getDecisionStats: async () => sampleStats,
    });
    render(S3DecisaoPanel, { api });
    await waitFor(() => {
      expect(screen.getByTestId("s3-stats")).toBeDefined();
    });
    const stats = screen.getByTestId("s3-stats");
    expect(stats.textContent).toContain("20%"); // cacheHitRate
    expect(stats.textContent).toContain("9.8"); // avgPoolSize
    expect(stats.textContent).toContain("0.77"); // avgTopScore
  });
});
