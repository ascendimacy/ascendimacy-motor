/**
 * Unit tests pro plugin parental-dashboard-routes (US-PE-01..09).
 *
 * Cobrem shape de resposta + validação de input. V0 endpoints retornam
 * stubs determinísticos com `developmentStub: true` — testes verificam
 * que campos esperados existem e que erros chegam com 400.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";

let server: BffServer;

const inject = async (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
) => {
  const res = await server.fastify.inject({
    method,
    url,
    ...(payload !== undefined ? { payload } : {}),
  });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null,
  };
};

beforeEach(() => {
  const db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
});

afterEach(async () => {
  await server.close();
});

describe("GET /parental/dashboard/:acquirerId", () => {
  it("retorna agregado com children + counts", async () => {
    const res = await inject("GET", "/parental/dashboard/yuji-ochiai");
    expect(res.status).toBe(200);
    const body = res.body as {
      acquirerId: string;
      acquirerName: string;
      generatedAt: string;
      pendingQuestionsCount: number;
      unreadAlertsCount: number;
      children: Array<{
        childId: string;
        name: string;
        engagedToday: boolean;
        oneLineSummary: string;
      }>;
    };
    expect(body.acquirerId).toBe("yuji-ochiai");
    expect(body.acquirerName).toBe("Yuji");
    expect(body.children.length).toBe(3);
    expect(body.children.map((c) => c.name).sort()).toEqual(
      ["Kei", "Ryo", "Saki"],
    );
    for (const c of body.children) {
      expect(typeof c.oneLineSummary).toBe("string");
      expect(c.oneLineSummary.length).toBeGreaterThan(0);
    }
    expect(typeof body.pendingQuestionsCount).toBe("number");
  });
});

describe("GET /parental/children/:childId/today", () => {
  it("retorna TodaySummary com data ISO + campos requeridos", async () => {
    const res = await inject("GET", "/parental/children/ryo-ochiai/today");
    expect(res.status).toBe(200);
    const body = res.body as {
      childId: string;
      date: string;
      engaged: boolean;
      durationMinutes: number;
      topicsDiscussed: string[];
    };
    expect(body.childId).toBe("ryo-ochiai");
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(body.topicsDiscussed)).toBe(true);
  });
});

describe("GET /parental/children/:childId/week", () => {
  it("retorna WeekProgress com 7 dias na timeline", async () => {
    const res = await inject("GET", "/parental/children/kei-ochiai/week");
    expect(res.status).toBe(200);
    const body = res.body as {
      moodTimeline: Array<{ date: string; mood: number | null }>;
      topThemes: string[];
      qualitativeSummary: string;
      sacrificeBudgetTotal: number;
    };
    expect(body.moodTimeline.length).toBe(7);
    expect(body.topThemes.length).toBeGreaterThan(0);
    expect(typeof body.qualitativeSummary).toBe("string");
    expect(body.sacrificeBudgetTotal).toBe(100);
  });
});

describe("GET /parental/children/:childId/cards", () => {
  it("retorna lista de cards físicos com QR + cheat-code", async () => {
    const res = await inject("GET", "/parental/children/saki-ochiai/cards");
    expect(res.status).toBe(200);
    const body = res.body as {
      cards: Array<{
        cardId: string;
        qrCodePayload: string;
        cheatCode: string;
        pdfUrl: string;
      }>;
    };
    expect(body.cards.length).toBeGreaterThan(0);
    for (const c of body.cards) {
      expect(c.qrCodePayload).toContain("ebrota://card/");
      expect(c.cheatCode.length).toBeGreaterThan(0);
      expect(c.pdfUrl.endsWith(".pdf")).toBe(true);
    }
  });
});

describe("GET /parental/children/:childId/conversations", () => {
  it("retorna lista de sessões com preview", async () => {
    const res = await inject(
      "GET",
      "/parental/children/ryo-ochiai/conversations?limit=3",
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      sessions: Array<{
        sessionId: string;
        preview: Array<{ from: string; text: string }>;
      }>;
    };
    expect(body.sessions.length).toBe(3);
    for (const s of body.sessions) {
      expect(s.preview.length).toBeGreaterThan(0);
    }
  });
});

describe("GET /parental/children/:childId/alerts", () => {
  it("retorna array (possivelmente vazio) de alertas", async () => {
    const res = await inject("GET", "/parental/children/kei-ochiai/alerts");
    expect(res.status).toBe(200);
    const body = res.body as { alerts: unknown[] };
    expect(Array.isArray(body.alerts)).toBe(true);
  });
});

describe("GET /parental/children/:childId/pulso-events", () => {
  it("retorna eventos com cultural context", async () => {
    const res = await inject(
      "GET",
      "/parental/children/ryo-ochiai/pulso-events",
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      events: Array<{ type: string; culturalContext: string }>;
    };
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events[0]!.culturalContext.length).toBeGreaterThan(0);
  });

  it("filtra por type", async () => {
    const res = await inject(
      "GET",
      "/parental/children/ryo-ochiai/pulso-events?type=omikuji",
    );
    expect(res.status).toBe(200);
    const body = res.body as { events: Array<{ type: string }> };
    for (const e of body.events) {
      expect(e.type).toBe("omikuji");
    }
  });
});

describe("GET /parental/escalation/pending-questions", () => {
  it("retorna lista de perguntas pendentes", async () => {
    const res = await inject("GET", "/parental/escalation/pending-questions");
    expect(res.status).toBe(200);
    const body = res.body as {
      questions: Array<{ questionId: string; rawQuestion: string }>;
    };
    expect(body.questions.length).toBeGreaterThan(0);
  });
});

describe("POST /parental/escalation/pending-questions/:id/answer", () => {
  it("aceita answerText e marca answered", async () => {
    const res = await inject(
      "POST",
      "/parental/escalation/pending-questions/pq-001/answer",
      { answerText: "O céu fica vermelho por causa da luz do pôr-do-sol." },
    );
    expect(res.status).toBe(200);
    const body = res.body as { status: string; scheduledForNextSession: boolean };
    expect(body.status).toBe("answered");
    expect(body.scheduledForNextSession).toBe(true);
  });

  it("rejeita body vazio com 400", async () => {
    const res = await inject(
      "POST",
      "/parental/escalation/pending-questions/pq-001/answer",
      {},
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /parental/escalation/report", () => {
  it("cria report e notifica Jun", async () => {
    const res = await inject("POST", "/parental/escalation/report", {
      childId: "ryo-ochiai",
      type: "tom",
      text: "Brota falou de um jeito que o Ryo achou meio chato.",
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      reportId: string;
      status: string;
      notifiedJun: boolean;
    };
    expect(body.reportId.startsWith("rep-")).toBe(true);
    expect(body.status).toBe("open");
    expect(body.notifiedJun).toBe(true);
  });

  it("rejeita texto >500 chars", async () => {
    const res = await inject("POST", "/parental/escalation/report", {
      childId: "ryo-ochiai",
      type: "tom",
      text: "x".repeat(501),
    });
    expect(res.status).toBe(400);
  });

  it("rejeita sem childId", async () => {
    const res = await inject("POST", "/parental/escalation/report", {
      type: "tom",
      text: "abc",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /parental/children/:childId/pause", () => {
  it("pausa imediato com razão", async () => {
    const res = await inject("POST", "/parental/children/saki-ochiai/pause", {
      reason: "criança cansada",
      immediate: true,
    });
    expect(res.status).toBe(200);
    const body = res.body as { paused: boolean; immediate: boolean };
    expect(body.paused).toBe(true);
    expect(body.immediate).toBe(true);
  });

  it("notifica Jun quando pausa >24h", async () => {
    const futureIso = new Date(
      Date.now() + 48 * 3600_000,
    ).toISOString();
    const res = await inject("POST", "/parental/children/saki-ochiai/pause", {
      reason: "viagem",
      pauseUntilIso: futureIso,
    });
    expect(res.status).toBe(200);
    const body = res.body as { notifiedJun: boolean };
    expect(body.notifiedJun).toBe(true);
  });

  it("rejeita sem reason", async () => {
    const res = await inject("POST", "/parental/children/saki-ochiai/pause", {});
    expect(res.status).toBe(400);
  });
});
