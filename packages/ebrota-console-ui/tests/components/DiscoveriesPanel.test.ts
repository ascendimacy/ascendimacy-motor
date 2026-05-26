/**
 * DiscoveriesPanel smoke tests — verifica consumo de /subjects/:id/discoveries
 * + /boundaries-summary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/svelte";

afterEach(() => cleanup());
import DiscoveriesPanel from "../../src/components/DiscoveriesPanel.svelte";
import { discoveriesPanelOpen, tracerSubjectId } from "../../src/lib/stores.js";
import type {
  ApiClient,
  SubjectKnowledgeEntryLike,
  BoundarySummary,
} from "../../src/lib/api.js";

const buildApi = (
  discoveries: SubjectKnowledgeEntryLike[] | Error,
  summary: BoundarySummary[] = [],
): ApiClient =>
  ({
    listSubjectDiscoveries: vi.fn(async () => {
      if (discoveries instanceof Error) throw discoveries;
      return { discoveries };
    }),
    getBoundariesSummary: vi.fn(async () => ({ summary })),
  }) as never;

beforeEach(() => {
  discoveriesPanelOpen.set(false);
  tracerSubjectId.set("test-subject");
});

const entry = (
  type: string,
  label: string,
  confidence = 0.8,
): SubjectKnowledgeEntryLike => ({
  id: `${type}-${label}`,
  type,
  source: "motor_inferred",
  confidence,
  payload: { label },
  turn_ref: "t1",
  session_id: "s1",
  created_at: "2026-05-26T10:00:00Z",
});

describe("DiscoveriesPanel", () => {
  it("não renderiza quando fechado", () => {
    render(DiscoveriesPanel, { api: buildApi([]) });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mostra empty state quando 0 descobertas", async () => {
    render(DiscoveriesPanel, { api: buildApi([]) });
    discoveriesPanelOpen.set(true);
    await waitFor(() => {
      expect(
        screen.getByText(/Nenhuma descoberta pra este sujeito ainda/),
      ).toBeDefined();
    });
  });

  it("renderiza timeline de descobertas com badges por type", async () => {
    render(DiscoveriesPanel, {
      api: buildApi([
        entry("interest", "tênis", 0.9),
        entry("value", "persistência", 0.7),
        entry("boundary_event", "corpo", 0.85),
      ]),
    });
    discoveriesPanelOpen.set(true);
    await waitFor(() => {
      expect(screen.getByText("tênis")).toBeDefined();
    });
    expect(screen.getByText("persistência")).toBeDefined();
    // "interest"/"value" aparecem como option do select filter + badge na lista
    expect(screen.getAllByText("interest").length).toBeGreaterThan(0);
    expect(screen.getAllByText("value").length).toBeGreaterThan(0);
    expect(screen.getByText(/conf=0\.90/)).toBeDefined();
  });

  it("renderiza boundaries summary agregado", async () => {
    render(DiscoveriesPanel, {
      api: buildApi(
        [entry("interest", "tênis")],
        [
          {
            topic_category: "corpo",
            count: 5,
            high_intensity_count: 2,
            last_seen_at: "2026-05-26T10:00:00Z",
          },
        ],
      ),
    });
    discoveriesPanelOpen.set(true);
    await waitFor(() => {
      expect(screen.getByText(/Boundaries/)).toBeDefined();
    });
    expect(screen.getByText("corpo")).toBeDefined();
    expect(screen.getByText(/5×/)).toBeDefined();
    expect(screen.getByText(/high 2/)).toBeDefined();
  });

  it("mostra erro quando API falha", async () => {
    render(DiscoveriesPanel, {
      api: buildApi(new Error("DB locked")),
    });
    discoveriesPanelOpen.set(true);
    await waitFor(() => {
      expect(screen.getByText(/DB locked/)).toBeDefined();
    });
  });
});
