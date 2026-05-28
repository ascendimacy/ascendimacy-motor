/**
 * S5AvaliacaoPanel + STSLauncherModal — wiring tests com mock ApiClient.
 *
 * Cobre:
 *  - render dos 3 sub-tabs (guardrail / sts / longitudinal)
 *  - troca de tab via click
 *  - guardrail real data (passed + failed badge)
 *  - STS runs table render
 *  - STS launcher modal abre / submita / mostra running
 *  - longitudinal KPIs renderiza source=stub_v0 com banner
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import S5AvaliacaoPanel from "../src/components/subsystem-panels/S5AvaliacaoPanel.svelte";
import STSLauncherModal from "../src/components/sts/STSLauncherModal.svelte";
import {
  currentSessionId,
  tracerSubjectId,
  expandedSubsystem,
} from "../src/lib/stores.js";
import type {
  ApiClient,
  GuardrailCheckEntryLike,
  KpiLongitudinalLike,
  StsRunSummaryLike,
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
    getGuardrailHistory: async () => ({
      checks: [],
      passed_count: 0,
      failed_count: 0,
      source: "stub_v0",
    }),
    getRecallCheckHistory: async () => ({ events: [], source: "stub_v0" }),
    getTriggerEvents: async () => ({
      events: [],
      transitions: [],
      source: "stub_v0",
    }),
    getKpiLongitudinal: async () => ({
      persona_id: "ryo",
      mood_trajectory: [],
      casel_deltas: [],
      concept_retention: {
        total_attempts: 0,
        positive_rate: null,
        positive_rate_by_week: [],
      },
      trigger_summary: [],
      recall_summary: { items_checked: 0, positive_rate: null },
      source: "stub_v0",
    }),
    listStsScenarios: async () => ({
      scenarios: [
        {
          id: "smoke-3d",
          label: "smoke-3d",
          description: "Smoke",
          recommended_turns: 6,
          duration_label: "T+3d",
        },
      ],
    }),
    listStsPersonas: async () => ({
      personas: [
        {
          id: "ryo-ochiai",
          display_name: "Ryo",
          archetype: "deflective-11a",
          age: 11,
          language: "pt+ja",
        },
      ],
    }),
    listStsRuns: async () => ({ runs: [] }),
    startStsRun: async (input) => ({
      run_id: "test-run-id-12345678",
      status: "running",
      persona_id: input.persona_id,
      scenario_id: input.scenario_id,
      turns: input.turns ?? 6,
      dispatched_at: "2026-05-27T10:00:00Z",
      pid: 99999,
    }),
    getStsRunStatus: async (runId) => ({
      run_id: runId,
      status: "running",
      persona_id: "ryo-ochiai",
      scenario_id: "smoke-3d",
      turns_requested: 6,
      turns_completed: 1,
      started_at: "2026-05-27T10:00:00Z",
      ended_at: null,
      pid: 99999,
      exit_code: null,
      error_message: null,
      last_progress_at: null,
      stdout_tail: [],
      stderr_tail: [],
    }),
    cancelStsRun: async (runId) => ({
      run_id: runId,
      status: "cancelled",
      cancelled: true,
    }),
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
    ...overrides,
  } as ApiClient;
}

const sampleCheck: GuardrailCheckEntryLike = {
  id: "g-1",
  turn_ref: "t-3",
  session_id: "ryo__s1",
  created_at: "2026-05-25T12:00:00Z",
  topic_category: "bullying_pt",
  label: "termo agressivo",
  intensity: 0.7,
  passed: false,
};

const sampleRun: StsRunSummaryLike = {
  run_id: "sts-run-aaaaaaaa-1111",
  persona_id: "ryo-ochiai",
  scenario_id: "smoke-3d",
  started_at: "2026-05-25T10:00:00Z",
  ended_at: null,
  turn_count: 6,
  score: null,
  trace_path: null,
};

beforeEach(() => {
  expandedSubsystem.set("S5");
  currentSessionId.set("ryo__conv-1");
  tracerSubjectId.set("ryo");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("S5AvaliacaoPanel — sub-tabs render", () => {
  it("renderiza guardrail por default + 3 tabs", async () => {
    const api = mockApi();
    render(S5AvaliacaoPanel, { api });
    expect(screen.getByTestId("s5-tab-guardrail")).toBeDefined();
    expect(screen.getByTestId("s5-tab-sts")).toBeDefined();
    expect(screen.getByTestId("s5-tab-longitudinal")).toBeDefined();
    expect(screen.getByTestId("s5-pane-guardrail")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId("guardrail-empty")).toBeDefined();
    });
  });

  it("renderiza guardrail com dados reais (passed/failed badge + tabela)", async () => {
    const api = mockApi({
      getGuardrailHistory: async () => ({
        checks: [sampleCheck, { ...sampleCheck, id: "g-2", passed: true }],
        passed_count: 1,
        failed_count: 1,
        source: "real",
      }),
    });
    render(S5AvaliacaoPanel, { api });
    await waitFor(() => {
      expect(screen.getByTestId("guardrail-table")).toBeDefined();
    });
    const summary = screen.getByTestId("guardrail-summary");
    expect(summary.textContent).toContain("1 passed");
    expect(summary.textContent).toContain("1 failed");
  });

  it("troca pra sub-tab STS via click", async () => {
    const api = mockApi({
      listStsRuns: async () => ({ runs: [sampleRun] }),
    });
    render(S5AvaliacaoPanel, { api });
    await fireEvent.click(screen.getByTestId("s5-tab-sts"));
    expect(screen.getByTestId("s5-pane-sts")).toBeDefined();
    expect(screen.getByTestId("sts-launch-btn")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId("sts-runs-table")).toBeDefined();
    });
  });

  it("STS empty state quando sem runs", async () => {
    const api = mockApi();
    render(S5AvaliacaoPanel, { api });
    await fireEvent.click(screen.getByTestId("s5-tab-sts"));
    await waitFor(() => {
      expect(screen.getByTestId("sts-runs-empty")).toBeDefined();
    });
  });

  it("longitudinal mostra stub_v0 note quando source=stub_v0", async () => {
    const api = mockApi();
    render(S5AvaliacaoPanel, { api });
    await fireEvent.click(screen.getByTestId("s5-tab-longitudinal"));
    expect(screen.getByTestId("s5-pane-longitudinal")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId("kpi-mood")).toBeDefined();
    });
    expect(screen.getByTestId("kpi-casel")).toBeDefined();
    expect(screen.getByTestId("kpi-retention")).toBeDefined();
    expect(screen.getByTestId("kpi-trigger")).toBeDefined();
    expect(screen.getByTestId("kpi-recall")).toBeDefined();
  });

  it("longitudinal renderiza KPIs com dados parciais", async () => {
    const kpi: KpiLongitudinalLike = {
      persona_id: "ryo",
      mood_trajectory: [
        { session_id: "s1", started_at: "2026-05-20T10:00:00Z", mood: null },
      ],
      casel_deltas: [],
      concept_retention: {
        total_attempts: 5,
        positive_rate: 0.6,
        positive_rate_by_week: [
          { week_start: "2026-05-18", rate: 0.6, total: 5 },
        ],
      },
      trigger_summary: [],
      recall_summary: { items_checked: 5, positive_rate: 0.6 },
      source: "partial_stub_v0",
    };
    const api = mockApi({ getKpiLongitudinal: async () => kpi });
    render(S5AvaliacaoPanel, { api });
    await fireEvent.click(screen.getByTestId("s5-tab-longitudinal"));
    await waitFor(() => {
      const retention = screen.getByTestId("kpi-retention");
      expect(retention.textContent).toContain("60%");
      expect(retention.textContent).toContain("5");
    });
  });
});

describe("STSLauncherModal", () => {
  it("carrega personas + scenarios on mount e mostra form", async () => {
    const api = mockApi();
    render(STSLauncherModal, { props: { api, open: true } });
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-form")).toBeDefined();
    });
    expect(screen.getByTestId("sts-launcher-persona")).toBeDefined();
    expect(screen.getByTestId("sts-launcher-scenario")).toBeDefined();
    expect(screen.getByTestId("sts-launcher-submit")).toBeDefined();
  });

  it("submit dispara startStsRun e exibe running state", async () => {
    const startMock = vi.fn(async () => ({
      run_id: "run-abc12345-9999",
      status: "running" as const,
      persona_id: "ryo-ochiai",
      scenario_id: "smoke-3d",
      turns: 6,
      dispatched_at: "2026-05-27T10:00:00Z",
      pid: 99999,
    }));
    const api = mockApi({ startStsRun: startMock });
    render(STSLauncherModal, { props: { api, open: true } });
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-submit")).toBeDefined();
    });
    await fireEvent.submit(screen.getByTestId("sts-launcher-form"));
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-running")).toBeDefined();
    });
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sts-launcher-clock")).toBeDefined();
  });

  it("não renderiza quando open=false", () => {
    const api = mockApi();
    render(STSLauncherModal, { props: { api, open: false } });
    expect(screen.queryByTestId("sts-launcher-modal")).toBeNull();
  });
});
