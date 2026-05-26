/**
 * MapsPanel smoke tests — verifica consumo de /frameworks + /subjects/:id/maps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/svelte";

afterEach(() => cleanup());
import MapsPanel from "../../src/components/MapsPanel.svelte";
import { mapsPanelOpen, tracerSubjectId } from "../../src/lib/stores.js";
import type {
  ApiClient,
  FrameworkMeta,
  SubjectMapLike,
} from "../../src/lib/api.js";

const frameworks = (): FrameworkMeta[] => [
  {
    id: "valores_classicos",
    display_name: "Valores clássicos",
    dimensions: ["axis_1", "axis_2", "axis_11"],
    render_hint: "radar",
  },
  {
    id: "gardner",
    display_name: "Gardner",
    dimensions: ["intrapersonal", "interpersonal"],
    render_hint: "bar",
  },
];

const buildApi = (
  fws: FrameworkMeta[] | Error,
  maps: SubjectMapLike | Error,
): ApiClient =>
  ({
    listFrameworks: vi.fn(async () => {
      if (fws instanceof Error) throw fws;
      return { frameworks: fws };
    }),
    getSubjectMaps: vi.fn(async () => {
      if (maps instanceof Error) throw maps;
      return { maps };
    }),
  }) as never;

beforeEach(() => {
  mapsPanelOpen.set(false);
  tracerSubjectId.set("test-subject");
});

describe("MapsPanel", () => {
  it("não renderiza modal quando fechado", () => {
    render(MapsPanel, {
      api: buildApi(frameworks(), {
        subject_id: "test-subject",
        computed_at: "2026-05-26",
        positions: {},
      }),
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mostra tabs de frameworks + dimensões com valor > 0", async () => {
    render(MapsPanel, {
      api: buildApi(frameworks(), {
        subject_id: "test-subject",
        computed_at: "2026-05-26T10:00:00Z",
        positions: {
          valores_classicos: { axis_1: 3, axis_2: 0, axis_11: 5 },
          gardner: { intrapersonal: 2, interpersonal: 0 },
        },
      }),
    });
    mapsPanelOpen.set(true);
    await waitFor(() => {
      expect(screen.getByText("Valores clássicos")).toBeDefined();
    });
    expect(screen.getByText("Gardner")).toBeDefined();
    // Default tab = valores_classicos; axis_1 e axis_11 visíveis (axis_2 = 0)
    expect(screen.getByText("axis_1")).toBeDefined();
    expect(screen.getByText("axis_11")).toBeDefined();
    expect(screen.queryByText("axis_2")).toBeNull();
  });

  it("mostra empty state quando nenhuma posição > 0", async () => {
    render(MapsPanel, {
      api: buildApi(frameworks(), {
        subject_id: "test-subject",
        computed_at: "2026-05-26",
        positions: { valores_classicos: { axis_1: 0, axis_2: 0 } },
      }),
    });
    mapsPanelOpen.set(true);
    await waitFor(() => {
      expect(
        screen.getByText(/Nenhuma posição com valor > 0/),
      ).toBeDefined();
    });
  });

  it("mostra erro quando getSubjectMaps falha", async () => {
    render(MapsPanel, {
      api: buildApi(frameworks(), new Error("maps endpoint 500")),
    });
    mapsPanelOpen.set(true);
    await waitFor(() => {
      expect(screen.getByText(/maps endpoint 500/)).toBeDefined();
    });
  });
});
