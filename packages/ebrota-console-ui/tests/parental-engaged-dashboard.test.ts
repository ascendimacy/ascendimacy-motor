/**
 * UI tests pro ParentalEngagedDashboard (US-PE-01..09).
 *
 * Cobre: render inicial + dashboard load + click no kid card + tab navigation.
 * Mocka fetch pra evitar BFF real; verifica que chamadas certas são feitas.
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import ParentalEngagedDashboard from "../src/components/parental/ParentalEngagedDashboard.svelte";

interface FetchCall {
  url: string;
  method: string;
}

const DASHBOARD_RESPONSE = {
  acquirerId: "yuji-ochiai",
  acquirerName: "Yuji",
  generatedAt: "2026-05-27T10:00:00Z",
  pendingQuestionsCount: 1,
  unreadAlertsCount: 0,
  children: [
    {
      childId: "ryo-ochiai",
      name: "Ryo",
      age: 8,
      primaryLanguage: "pt",
      avatarColor: "#5B8DEF",
      engagedToday: true,
      lastSeenAt: "2026-05-27T08:00:00Z",
      moodToday: 7.5,
      durationMinutesToday: 8,
      oneLineSummary: "Ryo conversou 8min, falou sobre joaninhas",
    },
    {
      childId: "kei-ochiai",
      name: "Kei",
      age: 6,
      primaryLanguage: "pt",
      avatarColor: "#F2A65A",
      engagedToday: false,
      lastSeenAt: null,
      moodToday: null,
      durationMinutesToday: 0,
      oneLineSummary: "Kei não interagiu hoje",
    },
    {
      childId: "saki-ochiai",
      name: "Saki",
      age: 4,
      primaryLanguage: "pt",
      avatarColor: "#E36588",
      engagedToday: true,
      lastSeenAt: "2026-05-27T07:00:00Z",
      moodToday: 6,
      durationMinutesToday: 5,
      oneLineSummary: "Saki conversou 5min, falou sobre estrelas",
    },
  ],
};

const TODAY_RESPONSE = {
  childId: "ryo-ochiai",
  date: "2026-05-27",
  engaged: true,
  moodAverage: 7.5,
  durationMinutes: 8,
  topicsDiscussed: ["joaninhas", "cores"],
  lastMessagePreview: "Brota: que cor de joaninha?",
  lastSeenAt: "2026-05-27T08:00:00Z",
  cardsEmittedToday: 1,
};

const WEEK_RESPONSE = {
  childId: "ryo-ochiai",
  weekStartIso: "2026-05-21",
  weekEndIso: "2026-05-27",
  moodTimeline: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-05-${21 + i}`,
    mood: 7,
  })),
  moodAverage: 7,
  cardsCount: 2,
  cardThumbnails: [],
  sacrificeBudgetTotal: 100,
  sacrificeBudgetUsed: 30,
  offScreenRatio: 2.5,
  topThemes: ["joaninhas", "estrelas"],
  qualitativeSummary: "Semana estável.",
};

const PENDING_QUESTIONS = {
  questions: [
    {
      questionId: "pq-001",
      childId: "saki-ochiai",
      raisedAt: "2026-05-27T05:00:00Z",
      brotaContextTurns: [{ from: "kid", text: "por que o céu fica vermelho?" }],
      rawQuestion: "por que o céu fica vermelho?",
      escalationReason: "tema científico",
      status: "open",
    },
  ],
};

function buildFetchMock(): {
  fn: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    if (url.endsWith("/parental/dashboard/yuji-ochiai")) {
      return jsonResponse(DASHBOARD_RESPONSE);
    }
    if (url.endsWith("/parental/escalation/pending-questions")) {
      return jsonResponse(PENDING_QUESTIONS);
    }
    if (url.endsWith("/today")) {
      return jsonResponse(TODAY_RESPONSE);
    }
    if (url.endsWith("/week")) {
      return jsonResponse(WEEK_RESPONSE);
    }
    if (url.endsWith("/cards")) {
      return jsonResponse({ childId: "ryo-ochiai", cards: [] });
    }
    if (url.includes("/conversations")) {
      return jsonResponse({ childId: "ryo-ochiai", sessions: [] });
    }
    if (url.endsWith("/alerts")) {
      return jsonResponse({ childId: "ryo-ochiai", alerts: [] });
    }
    if (url.includes("/pulso-events")) {
      return jsonResponse({ childId: "ryo-ochiai", events: [] });
    }
    if (url.includes("/parental/mc1/status")) {
      if (url.includes("childId=ryo-ochiai")) {
        return jsonResponse({
          childId: "ryo-ochiai",
          status: "pending",
          deliveredAt: null,
          scheduledAt: "2026-05-27T10:00:00Z",
          targetWindowName: "post-school-jp",
        });
      }
      if (url.includes("childId=kei-ochiai")) {
        return jsonResponse({
          childId: "kei-ochiai",
          status: "delivered",
          deliveredAt: "2026-05-27T09:00:00Z",
          scheduledAt: "2026-05-26T10:00:00Z",
        });
      }
      return jsonResponse({
        childId: "saki-ochiai",
        status: "not_scheduled",
        deliveredAt: null,
        scheduledAt: null,
      });
    }
    return jsonResponse({});
  };
  return { fn: fn as typeof globalThis.fetch, calls };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("ParentalEngagedDashboard", () => {
  it("renderiza saudação + 3 kid cards após load", async () => {
    const { fn, calls } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    await waitFor(() => {
      expect(screen.getByText(/Olá, Yuji/)).toBeTruthy();
    });

    const cards = await screen.findAllByTestId("kid-summary-card");
    expect(cards.length).toBe(3);

    expect(screen.getByText("Ryo")).toBeTruthy();
    expect(screen.getByText("Kei")).toBeTruthy();
    expect(screen.getByText("Saki")).toBeTruthy();

    expect(
      calls.some((c) => c.url.endsWith("/parental/dashboard/yuji-ochiai")),
    ).toBe(true);
  });

  it("seleciona primeira criança por default e carrega tab Hoje", async () => {
    const { fn, calls } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    await waitFor(() => {
      expect(
        calls.some((c) => c.url.endsWith("/parental/children/ryo-ochiai/today")),
      ).toBe(true);
    });

    expect(await screen.findByText(/Hoje — Ryo/)).toBeTruthy();
  });

  it("muda criança selecionada ao clicar em outro card", async () => {
    const { fn, calls } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    const cards = await screen.findAllByTestId("kid-summary-card");
    const sakiCard = cards.find(
      (c) => c.getAttribute("data-child-id") === "saki-ochiai",
    );
    expect(sakiCard).toBeTruthy();
    await fireEvent.click(sakiCard!);

    await waitFor(() => {
      expect(
        calls.some((c) =>
          c.url.endsWith("/parental/children/saki-ochiai/today"),
        ),
      ).toBe(true);
    });
  });

  it("navega entre sub-tabs", async () => {
    const { fn, calls } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    await screen.findByTestId("kid-tabs");
    await fireEvent.click(screen.getByTestId("tab-semana"));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url.endsWith("/parental/children/ryo-ochiai/week")),
      ).toBe(true);
    });
    expect(await screen.findByText(/Semana — Ryo/)).toBeTruthy();

    await fireEvent.click(screen.getByTestId("tab-cards"));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url.endsWith("/parental/children/ryo-ochiai/cards")),
      ).toBe(true);
    });

    await fireEvent.click(screen.getByTestId("tab-pulso"));
    await waitFor(() => {
      expect(
        calls.some((c) =>
          c.url.endsWith("/parental/children/ryo-ochiai/pulso-events"),
        ),
      ).toBe(true);
    });
  });

  it("mostra badge de perguntas pendentes e abre modal", async () => {
    const { fn } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    const trigger = await screen.findByTestId("open-pending-questions");
    expect(trigger.textContent).toMatch(/Pergunta pendente/);
    await fireEvent.click(trigger);
    await screen.findByTestId("pending-question-modal");
  });

  it("abre form de Reportar problema", async () => {
    const { fn } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    const trigger = await screen.findByTestId("open-report");
    await fireEvent.click(trigger);
    await screen.findByTestId("problem-report-form");
  });

  it("abre modal de Pausar Brota", async () => {
    const { fn } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    const trigger = await screen.findByTestId("open-pause");
    await fireEvent.click(trigger);
    await screen.findByTestId("pause-confirm");
  });

  it("mostra badge MC1 pendente apenas em crianças com status=pending", async () => {
    const { fn, calls } = buildFetchMock();
    render(ParentalEngagedDashboard, {
      props: { fetchImpl: fn, acquirerId: "yuji-ochiai" },
    });

    await waitFor(() => {
      expect(
        calls.some((c) =>
          c.url.includes("/parental/mc1/status?childId=ryo-ochiai"),
        ),
      ).toBe(true);
    });

    const badges = await screen.findAllByTestId("mc1-pending-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]!.getAttribute("data-child-id")).toBe("ryo-ochiai");
  });
});
