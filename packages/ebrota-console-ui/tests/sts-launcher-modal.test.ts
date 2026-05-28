/**
 * STSLauncherModal — real spawn polling tests.
 *
 * Cobre o flow novo (PR substitui stub do #258):
 *  - submit dispara startStsRun → polling status a cada pollMs
 *  - progress bar reflete turns_completed
 *  - cancel button visível em running; chama cancelStsRun
 *  - estado terminal (succeeded/failed/cancelled) mostra exit code + tail
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/svelte";
import STSLauncherModal from "../src/components/sts/STSLauncherModal.svelte";
import type {
  ApiClient,
  StsRunStatusResultLike,
  StsRunStartResultLike,
  StsRunCancelResultLike,
} from "../src/lib/api.js";

function baseMockApi(overrides: Partial<ApiClient> = {}): ApiClient {
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
    getGuardrailHistory: stub,
    getRecallCheckHistory: stub,
    getTriggerEvents: stub,
    getKpiLongitudinal: stub,
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
      run_id: "test-run-id-9999",
      status: "running",
      persona_id: input.persona_id,
      scenario_id: input.scenario_id,
      turns: input.turns ?? 6,
      dispatched_at: "2026-05-27T10:00:00Z",
      pid: 99999,
    }),
    getStsRunStatus: stub,
    cancelStsRun: stub,
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

function statusResp(
  overrides: Partial<StsRunStatusResultLike> = {},
): StsRunStatusResultLike {
  return {
    run_id: "test-run-id-9999",
    status: "running",
    persona_id: "ryo-ochiai",
    scenario_id: "smoke-3d",
    turns_requested: 6,
    turns_completed: 0,
    started_at: "2026-05-27T10:00:00Z",
    ended_at: null,
    pid: 99999,
    exit_code: null,
    error_message: null,
    last_progress_at: null,
    stdout_tail: [],
    stderr_tail: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("STSLauncherModal — polling + real spawn", () => {
  it("após submit, chama getStsRunStatus em loop até succeeded", async () => {
    let callCount = 0;
    const getStatus = vi.fn(async (): Promise<StsRunStatusResultLike> => {
      callCount += 1;
      if (callCount < 3) {
        return statusResp({ turns_completed: callCount, status: "running" });
      }
      return statusResp({
        turns_completed: 6,
        status: "succeeded",
        exit_code: 0,
        ended_at: "2026-05-27T10:00:10Z",
        stdout_tail: ["STS RUN STARTED", "STS RUN COMPLETED"],
      });
    });

    const api = baseMockApi({ getStsRunStatus: getStatus });
    render(STSLauncherModal, { props: { api, open: true, pollMs: 20 } });
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-submit")).toBeDefined();
    });
    await fireEvent.submit(screen.getByTestId("sts-launcher-form"));

    await waitFor(
      () => {
        expect(screen.getByTestId("sts-launcher-finished")).toBeDefined();
      },
      { timeout: 2000 },
    );
    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("progress bar reflete turns_completed", async () => {
    const getStatus = vi.fn(async () =>
      statusResp({ turns_completed: 4, status: "running" }),
    );
    const api = baseMockApi({ getStsRunStatus: getStatus });
    render(STSLauncherModal, { props: { api, open: true, pollMs: 20 } });
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-submit")).toBeDefined();
    });
    await fireEvent.submit(screen.getByTestId("sts-launcher-form"));

    await waitFor(() => {
      const progress = screen.getByTestId("sts-launcher-progress");
      expect(progress.textContent).toContain("4/6");
    });
    const bar = screen.getByTestId("sts-launcher-progress-bar") as HTMLProgressElement;
    expect(bar.value).toBe(4);
    expect(bar.max).toBe(6);
  });

  it("botão cancel visível em running e chama cancelStsRun", async () => {
    const getStatus = vi.fn(async () =>
      statusResp({ status: "running", turns_completed: 1 }),
    );
    const cancelMock = vi.fn(
      async (): Promise<StsRunCancelResultLike> => ({
        run_id: "test-run-id-9999",
        status: "cancelled",
        cancelled: true,
      }),
    );
    const api = baseMockApi({
      getStsRunStatus: getStatus,
      cancelStsRun: cancelMock,
    });
    render(STSLauncherModal, { props: { api, open: true, pollMs: 50 } });
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-submit")).toBeDefined();
    });
    await fireEvent.submit(screen.getByTestId("sts-launcher-form"));

    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-cancel")).toBeDefined();
    });
    await fireEvent.click(screen.getByTestId("sts-launcher-cancel"));
    expect(cancelMock).toHaveBeenCalledWith("test-run-id-9999");
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-finished")).toBeDefined();
    });
  });

  it("estado finished mostra exit code + logs tail", async () => {
    const getStatus = vi.fn(
      async (): Promise<StsRunStatusResultLike> =>
        statusResp({
          status: "succeeded",
          turns_completed: 6,
          exit_code: 0,
          ended_at: "2026-05-27T10:00:10Z",
          stdout_tail: ["STS RUN STARTED", "turn 1/6", "STS RUN COMPLETED"],
          stderr_tail: [],
        }),
    );
    const api = baseMockApi({ getStsRunStatus: getStatus });
    render(STSLauncherModal, { props: { api, open: true, pollMs: 20 } });
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-submit")).toBeDefined();
    });
    await fireEvent.submit(screen.getByTestId("sts-launcher-form"));
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-finished")).toBeDefined();
    });
    expect(screen.getByTestId("sts-launcher-exit-code").textContent).toContain("0");
    expect(screen.getByTestId("sts-launcher-logs")).toBeDefined();
  });

  it("estado failed mostra error_message", async () => {
    const getStatus = vi.fn(
      async (): Promise<StsRunStatusResultLike> =>
        statusResp({
          status: "failed",
          exit_code: 1,
          error_message: "STS RUN FAILED scenario=fail-fast turn=3",
          stderr_tail: ["STS RUN FAILED"],
        }),
    );
    const api = baseMockApi({ getStsRunStatus: getStatus });
    render(STSLauncherModal, { props: { api, open: true, pollMs: 20 } });
    await waitFor(() => {
      expect(screen.getByTestId("sts-launcher-submit")).toBeDefined();
    });
    await fireEvent.submit(screen.getByTestId("sts-launcher-form"));
    await waitFor(() => {
      const errEl = screen.getByTestId("sts-launcher-error-message");
      expect(errEl.textContent).toContain("STS RUN FAILED");
    });
  });
});
