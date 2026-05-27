/**
 * B1SocialPanel — render com mock ApiClient.
 *
 * Cobre:
 *  - loading state inicial
 *  - render com dados completos (cards + budget + dyad + windows)
 *  - empty states (sem cards, sem dyad, sem fixture de window)
 *  - error state
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/svelte";
import B1SocialPanel from "../src/components/subsystem-panels/B1SocialPanel.svelte";
import { expandedSubsystem, tracerSubjectId } from "../src/lib/stores.js";
import type { ApiClient } from "../src/lib/api.js";

function buildApi(over: Partial<ApiClient> = {}): ApiClient {
  const base: Partial<ApiClient> = {
    listEmittedCards: vi.fn().mockResolvedValue({ cards: [] }),
    getSacrificeBudget: vi.fn().mockResolvedValue({
      persona_id: "ryo-ochiai",
      baseline: 15,
      current: 15,
      mood: 5,
      trust: 0.5,
      modifiers: [
        { label: "mood ≥ 7 (+5)", delta: 5, active: false },
        { label: "mood < 5 (-5)", delta: -5, active: false },
        { label: "trust ≥ 0.8 (+3)", delta: 3, active: false },
        { label: "trust < 0.5 (-5)", delta: -5, active: false },
      ],
      source: "stub_v0",
    }),
    getDyad: vi.fn().mockResolvedValue({ dyad: null, source: "stub_v0" }),
    getTemporalWindows: vi.fn().mockResolvedValue(null),
    listPulsoEvents: vi.fn().mockResolvedValue({ events: [] }),
  };
  return { ...base, ...over } as ApiClient;
}

beforeEach(() => {
  expandedSubsystem.set("B1");
  tracerSubjectId.set("ryo-ochiai");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("B1SocialPanel", () => {
  it("mostra loading enquanto carrega", () => {
    const api = buildApi();
    render(B1SocialPanel, { props: { api } });
    expect(screen.getByTestId("b1-loading")).toBeDefined();
  });

  it("renderiza blocos básicos após carregar (sem cards, sem windows)", async () => {
    const api = buildApi();
    render(B1SocialPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("b1-loading")).toBeNull();
    });
    expect(screen.getByTestId("b1-cards-block")).toBeDefined();
    expect(screen.getByTestId("b1-budget-block")).toBeDefined();
    expect(screen.getByTestId("b1-dyad-block")).toBeDefined();
    expect(screen.getByTestId("b1-windows-block")).toBeDefined();
    expect(screen.getByTestId("b1-pulso-block")).toBeDefined();
    // empty state pra cards
    expect(screen.getByText(/Nenhum card emitido/)).toBeDefined();
    // dyad stub null
    expect(screen.getByText(/Sem dyad ativo/)).toBeDefined();
  });

  it("renderiza cards quando há dados", async () => {
    const api = buildApi({
      listEmittedCards: vi.fn().mockResolvedValue({
        cards: [
          {
            card_id: "c-001",
            child_id: "ryo-ochiai",
            session_id: "s-1",
            archetype_id: "naturalist:butterfly",
            signature: "sig-1",
            emitted_at: "2026-05-27T10:00:00Z",
            front: { title: "Borboleta laranja", rarity: "rare" },
            back: { serial_number: "0001", cheat_code: "PAPILIO-7X" },
          },
        ],
      }),
    });
    render(B1SocialPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("b1-loading")).toBeNull();
    });
    const cards = screen.getAllByTestId("b1-card");
    expect(cards.length).toBe(1);
    expect(screen.getByText("Borboleta laranja")).toBeDefined();
    expect(screen.getByText("PAPILIO-7X")).toBeDefined();
  });

  it("renderiza budget gauge com baseline/current", async () => {
    const api = buildApi({
      getSacrificeBudget: vi.fn().mockResolvedValue({
        persona_id: "ryo-ochiai",
        baseline: 15,
        current: 20,
        mood: 8,
        trust: 0.5,
        modifiers: [
          { label: "mood ≥ 7 (+5)", delta: 5, active: true },
          { label: "mood < 5 (-5)", delta: -5, active: false },
          { label: "trust ≥ 0.8 (+3)", delta: 3, active: false },
          { label: "trust < 0.5 (-5)", delta: -5, active: false },
        ],
        source: "stub_v0",
      }),
    });
    render(B1SocialPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("b1-loading")).toBeNull();
    });
    expect(screen.getByText("20 / 15")).toBeDefined();
    expect(screen.getByText(/mood ≥ 7/)).toBeDefined();
  });

  it("renderiza tabela de janelas quando há fixture", async () => {
    const api = buildApi({
      getTemporalWindows: vi.fn().mockResolvedValue({
        persona_id: "ryo-ochiai",
        timezone: "Asia/Tokyo",
        windows: [
          {
            name: "post-school-jp",
            weekday: ["mon", "tue", "wed", "thu", "fri"],
            start_local: "16:30",
            end_local: "17:30",
            max_hooks_per_day: 1,
            requires_parental_ok: true,
          },
        ],
        school_window: { start_local: "08:00", end_local: "15:30" },
        sleep_window: { start_local: "21:00", end_local: "06:30" },
      }),
    });
    render(B1SocialPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.queryByTestId("b1-loading")).toBeNull();
    });
    expect(screen.getByText("Asia/Tokyo")).toBeDefined();
    expect(screen.getByText("post-school-jp")).toBeDefined();
    expect(screen.getByText("16:30")).toBeDefined();
  });

  it("renderiza error state quando API falha", async () => {
    const api = buildApi({
      listEmittedCards: vi.fn().mockRejectedValue(new Error("BFF down")),
    });
    render(B1SocialPanel, { props: { api } });
    await waitFor(() => {
      expect(screen.getByTestId("b1-error")).toBeDefined();
    });
    expect(screen.getByText(/BFF down/)).toBeDefined();
  });
});
