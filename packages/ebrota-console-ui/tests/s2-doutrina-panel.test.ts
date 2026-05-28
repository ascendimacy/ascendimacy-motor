/**
 * S2DoutrinaPanel — wiring tests com mock ApiClient.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 *
 * Cobre:
 *  - Loading state (3 sub-cards)
 *  - 3 sub-cards renderizados com dados reais
 *  - Journey timeline highlight correto por stage
 *  - Error fallback pra PlaceholderBanner
 *  - Stub note quando developmentStub=true
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/svelte";
import S2DoutrinaPanel from "../src/components/subsystem-panels/S2DoutrinaPanel.svelte";
import {
  currentSessionId,
  tracerSubjectId,
  expandedSubsystem,
} from "../src/lib/stores.js";
import type {
  ApiClient,
  ActivePlaybookLike,
  JourneyStageInfoLike,
  DrotaConfigLike,
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
    getActivePlaybook: async () => samplePlaybook,
    getJourneyStage: async () => sampleStage,
    getDrotaConfig: async () => sampleDrota,
    ...overrides,
  } as ApiClient;
}

const samplePlaybook: ActivePlaybookLike = {
  personaId: "ryo",
  playbookId: "kids.brota.v1",
  playbookName: "Brota — Kids tutor v1",
  version: "1.0.0",
  appliedAt: "2026-05-27T10:00:00Z",
  appliedReason: "wizard_complete",
  developmentStub: false,
};

const sampleStage: JourneyStageInfoLike = {
  personaId: "ryo",
  stage: "mapping_ready",
  stageEnteredAt: "2026-05-20T10:00:00Z",
  turnsInStage: 12,
  nextStageHint: "applied_double_helix",
  blockedBy: "consent_required",
};

const sampleDrota: DrotaConfigLike = {
  personaId: "ryo",
  drotaProfile: "kids",
  splitDrotaEnabled: false,
  splitDrotaSource: "env",
  registerDefault: "lúdico",
  developmentStub: false,
};

beforeEach(() => {
  expandedSubsystem.set("S2");
  currentSessionId.set("ryo__conv-1");
  tracerSubjectId.set("ryo");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("S2DoutrinaPanel — wiring", () => {
  it("loading state visível em 3 sub-cards durante fetch", () => {
    const never = new Promise<never>(() => {});
    const api = mockApi({
      getActivePlaybook: () => never as Promise<ActivePlaybookLike>,
      getJourneyStage: () => never as Promise<JourneyStageInfoLike>,
      getDrotaConfig: () => never as Promise<DrotaConfigLike>,
    });

    render(S2DoutrinaPanel, { api });

    expect(screen.getByTestId("playbook-loading")).toBeDefined();
    expect(screen.getByTestId("stage-loading")).toBeDefined();
    expect(screen.getByTestId("drota-loading")).toBeDefined();
  });

  it("renderiza 3 sub-cards com dados reais (playbook + journey + drota)", async () => {
    const api = mockApi();
    render(S2DoutrinaPanel, { api });

    await waitFor(() => {
      expect(screen.getByTestId("playbook-card")).toBeDefined();
    });
    expect(screen.getByText("Brota — Kids tutor v1")).toBeDefined();
    expect(screen.getByText("kids.brota.v1")).toBeDefined();
    expect(screen.getByTestId("stage-timeline")).toBeDefined();
    expect(screen.getByTestId("drota-card")).toBeDefined();
    expect(screen.getByText(/lúdico/)).toBeDefined();
  });

  it("timeline destaca stage atual e marca next como hint", async () => {
    const api = mockApi();
    render(S2DoutrinaPanel, { api });

    await waitFor(() => {
      expect(screen.getByTestId("stage-mapping_ready")).toBeDefined();
    });

    const current = screen.getByTestId("stage-mapping_ready");
    expect(current.getAttribute("data-current")).toBe("true");
    expect(current.className).toContain("stage-current");

    const next = screen.getByTestId("stage-applied_double_helix");
    expect(next.getAttribute("data-current")).toBe("false");
    expect(next.className).toContain("stage-next-hint");

    const past = screen.getByTestId("stage-discovery_only");
    expect(past.className).toContain("stage-past");
  });

  it("error → fallback pra PlaceholderBanner em cada sub-card", async () => {
    const api = mockApi({
      getActivePlaybook: async () => {
        throw new Error("BFF offline");
      },
      getJourneyStage: async () => {
        throw new Error("BFF offline");
      },
      getDrotaConfig: async () => {
        throw new Error("BFF offline");
      },
    });

    render(S2DoutrinaPanel, { api });

    await waitFor(() => {
      expect(screen.getByTestId("playbook-error")).toBeDefined();
    });
    expect(screen.getByTestId("stage-error")).toBeDefined();
    expect(screen.getByTestId("drota-error")).toBeDefined();
  });

  it("developmentStub render nota e badge default", async () => {
    const api = mockApi({
      getActivePlaybook: async () => ({
        ...samplePlaybook,
        playbookName: "unknown_playbook",
        appliedReason: "default_at_persona_create",
        developmentStub: true,
      }),
      getDrotaConfig: async () => ({
        ...sampleDrota,
        developmentStub: true,
      }),
    });

    render(S2DoutrinaPanel, { api });

    await waitFor(() => {
      expect(screen.getByTestId("playbook-stub-note")).toBeDefined();
    });
    expect(screen.getByTestId("drota-stub-note")).toBeDefined();
    expect(screen.getByTestId("playbook-reason").textContent).toMatch(/default/);
  });
});
