/**
 * JourneyPanel smoke tests — verifica que UI consome /subjects/:id/journey-state
 * corretamente em cenários vazio, populado e com override parental.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/svelte";

afterEach(() => cleanup());
import JourneyPanel from "../../src/components/JourneyPanel.svelte";
import { journeyPanelOpen, tracerSubjectId } from "../../src/lib/stores.js";
import type { ApiClient, JourneyStateLike } from "../../src/lib/api.js";

const buildApi = (state: JourneyStateLike | Error): ApiClient =>
  ({
    getJourneyState: vi.fn(async () => {
      if (state instanceof Error) throw state;
      return { state };
    }),
    setJourneyOverride: vi.fn(async (_id, stage, reason) => ({
      state: {
        ...(state as JourneyStateLike),
        stage: stage as JourneyStateLike["stage"],
        override_by_parent: { forced_stage: stage, reason, timestamp: "now" },
      },
    })),
    clearJourneyOverride: vi.fn(async () => ({ state: state as JourneyStateLike })),
  }) as never;

beforeEach(() => {
  journeyPanelOpen.set(false);
  tracerSubjectId.set("test-subject");
});

describe("JourneyPanel", () => {
  it("não renderiza modal quando fechado", () => {
    render(JourneyPanel, { api: buildApi(makeState("discovery_only")) });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mostra stage atual quando populado", async () => {
    render(JourneyPanel, {
      api: buildApi(makeState("applied_double_helix", 18, ["carater", "disposicao"])),
    });
    journeyPanelOpen.set(true);
    await waitFor(() => {
      // applied_double_helix aparece no select option + no badge → vários matches
      expect(screen.getAllByText("applied_double_helix").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/18/)).toBeDefined();
  });

  it("mostra override parental quando presente", async () => {
    const state = makeState("mapping_ready", 5, ["carater"]);
    state.override_by_parent = {
      forced_stage: "mapping_ready",
      reason: "ainda sentindo cedo",
      timestamp: "2026-05-26T10:00:00Z",
    };
    render(JourneyPanel, { api: buildApi(state) });
    journeyPanelOpen.set(true);
    await waitFor(() => {
      expect(screen.getByText(/ainda sentindo cedo/)).toBeDefined();
    });
  });

  it("mostra erro quando API falha", async () => {
    render(JourneyPanel, { api: buildApi(new Error("BFF offline")) });
    journeyPanelOpen.set(true);
    await waitFor(() => {
      expect(screen.getByText(/BFF offline/)).toBeDefined();
    });
  });
});

function makeState(
  stage: JourneyStateLike["stage"],
  discoveries = 0,
  families: string[] = [],
): JourneyStateLike {
  return {
    subject_id: "test-subject",
    stage,
    stage_entered_at: "2026-05-20T10:00:00Z",
    discoveries_count: discoveries,
    families_covered: families,
    last_updated_at: "2026-05-26T10:00:00Z",
  };
}
