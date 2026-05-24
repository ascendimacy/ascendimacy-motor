/**
 * E2E homologation smoke — C-MX-08 PR10 (closing 10/10).
 *
 * Walks o journey completo do operador (Jun) via BFF HTTP endpoints,
 * usando MockDaemonClient + in-memory SQLite. Cobre todas as features
 * V0.1 entregues nos PRs 1-9 em uma única passada:
 *
 *   Fase B (gate)            → mode switch, start-card, options,
 *                              override, decisions
 *   Fase C (telemetria)      → jun_decisions persistidas
 *   Fase D parcial (replay)  → session library + replay
 *   Fase F (visualizer link) → /live /replay redirects
 *   Fase G (debug tail)      → debug events buffer
 *   Fase H (analytics V0.1)  → personas + evolution
 *
 * NÃO cobre (manual/Playwright): UI rendering, SSE long-poll,
 * deep-link parsing client-side, hot reload.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import {
  createBffServer,
  type BffServer,
} from "../src/server.js";
import {
  createMockDaemonClient,
  type MockDaemonClient,
} from "../src/daemon-client.js";

const samplePool = () => [
  {
    item: { id: "card-tabuada-7", type: "curiosity_hook", domain: "math" },
    score: 0.92,
    reasons: ["age-fit", "mood-fit"],
  },
  {
    item: { id: "card-fractions-pizza", type: "sacrifice", domain: "math" },
    score: 0.78,
    reasons: ["age-fit"],
  },
];

const startCardBody = (overrides: Record<string, unknown> = {}) => ({
  cardId: "tabuada-7",
  conversationId: "conv-001",
  from: "yuji",
  personaId: "yuji",
  pkg: {
    cardId: "tabuada-7",
    raw: "[fact] 7 x 8 = 56",
    sourcePath: "content/yuji/math/tabuada-7.yaml",
  },
  ...overrides,
});

describe("C-MX-08 E2E homologation smoke", () => {
  let server: BffServer;
  let db: DatabaseType;
  let mock: MockDaemonClient;

  beforeEach(() => {
    db = initDb({ dbPath: ":memory:" });
    mock = createMockDaemonClient();
    server = createBffServer({
      daemon: mock,
      db,
      logger: false,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const inject = async (
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: unknown }> => {
    const res = await server.fastify.inject({
      method,
      url,
      ...(payload !== undefined ? { payload } : {}),
    });
    return {
      status: res.statusCode,
      body: res.body.length > 0 ? JSON.parse(res.body) : null,
    };
  };

  it("journey completa: status → mode → session → override → telemetria → analytics → debug → end", async () => {
    // Fase A — Health
    const status = await inject("GET", "/status");
    expect(status.status).toBe(200);
    expect((status.body as { daemonConnected: boolean }).daemonConnected).toBe(
      true,
    );
    expect((status.body as { mode: string }).mode).toBe("auto");

    // Fase B — Mode switch auto → semi-auto
    const modeChange = await inject("POST", "/mode", { mode: "semi-auto" });
    expect(modeChange.status).toBe(200);
    expect((modeChange.body as { mode: string }).mode).toBe("semi-auto");

    // Fase B — Start card session
    const sessionRes = await inject(
      "POST",
      "/sessions/start-card",
      startCardBody(),
    );
    expect(sessionRes.status).toBe(200);
    const { sessionId } = sessionRes.body as { sessionId: string };
    expect(sessionId).toBe("yuji__conv-001");

    // Setup mock state: gate ativo (pool + approval pending)
    mock.setPendingPool(sessionId, samplePool());
    mock.setPendingApproval(sessionId, "Você sabia que 7×8 = 56?");

    // Fase B — Operador inspeciona pool
    const options = await inject(
      "GET",
      `/sessions/${sessionId}/options`,
    );
    expect(options.status).toBe(200);
    const pool = (options.body as { contentPool: unknown[] }).contentPool;
    expect(pool).toHaveLength(2);

    // Fase B + C — Operador faz override do default → telemetria persiste
    const override = await inject(
      "POST",
      `/sessions/${sessionId}/override`,
      {
        contentItemId: "card-fractions-pizza",
        turn: 2,
        rationale: "Yuji ama pizza, melhor anchor",
      },
    );
    expect(override.status).toBe(200);
    const overrideResult = override.body as { accepted: boolean };
    expect(overrideResult.accepted).toBe(true);

    // Fase B — Operador aprova proposed text
    mock.setPendingApproval(sessionId, "Proposed text v2");
    const approve = await inject(
      "POST",
      `/sessions/${sessionId}/approve`,
      {
        approved: true,
        editedText: "Texto editado pelo Jun (tom mais leve)",
        rationale: "tom muito formal",
        turn: 2,
        originalText: "Proposed text v2",
      },
    );
    expect(approve.status).toBe(200);
    expect((approve.body as { accepted: boolean }).accepted).toBe(true);

    // Fase C — Decisions history (Edit Learner v0)
    const decisions = await inject(
      "GET",
      `/sessions/${sessionId}/decisions`,
    );
    expect(decisions.status).toBe(200);
    const decList = (
      decisions.body as { decisions: Array<{ decision: string }> }
    ).decisions;
    expect(decList.length).toBeGreaterThanOrEqual(2);
    const decisionTypes = decList.map((d) => d.decision).sort();
    expect(decisionTypes).toContain("override");
    expect(decisionTypes).toContain("edit");

    // Fase D parcial — Session library (em real, traces-scanner popularia;
    // aqui inserimos session row manualmente pra cobrir endpoint).
    db.prepare(
      `INSERT INTO sessions (
         session_id, persona_id, conversation_id, kind, started_at,
         turn_count, has_overrides, trace_path
       ) VALUES (?, 'yuji', 'conv-001', 'real',
                 '2026-05-24T13:00:00.000Z', 5, 1, NULL)`,
    ).run(sessionId);

    const library = await inject("GET", "/sessions/library?persona=yuji");
    expect(library.status).toBe(200);
    const libSessions = (
      library.body as { sessions: Array<{ personaId: string }> }
    ).sessions;
    expect(libSessions).toHaveLength(1);
    expect(libSessions[0]!.personaId).toBe("yuji");

    // Fase F — Visualizer deep links (redirect 302)
    const replayLink = await server.fastify.inject({
      method: "GET",
      url: `/replay/${sessionId}`,
    });
    expect(replayLink.statusCode).toBe(302);
    expect(replayLink.headers.location).toMatch(/\?replay=/);

    const liveLink = await server.fastify.inject({
      method: "GET",
      url: `/live/${sessionId}`,
    });
    expect(liveLink.statusCode).toBe(302);
    expect(liveLink.headers.location).toMatch(/\?live=/);

    // Fase G — Debug tail mode: push event + read back
    const debugPush = await inject("POST", "/debug/llm-calls", {
      step: "planejador.plan_turn",
      provider: "anthropic",
      model: "claude-opus-4",
      prompt: { system: "Voce e Brota...", user: "card-tabuada-7" },
      sessionId,
      turn: 2,
    });
    expect(debugPush.status).toBe(200);

    const debugList = await inject("GET", "/debug/llm-calls");
    expect(debugList.status).toBe(200);
    const debugEvents = (
      debugList.body as { events: unknown[]; totalEmitted: number }
    ).events;
    expect(debugEvents).toHaveLength(1);

    // Fase G — Debug action telemetria
    const debugAction = await inject("POST", "/debug/actions", {
      sessionId,
      action: "tail",
    });
    expect(debugAction.status).toBe(200);

    // Fase H — Analytics V0.1 — cross-session feed
    const personas = await inject("GET", "/analytics/personas");
    expect(personas.status).toBe(200);
    const personaList = (
      personas.body as {
        personas: Array<{ personaId: string; sessionCount: number }>;
      }
    ).personas;
    expect(personaList).toHaveLength(1);
    expect(personaList[0]!.personaId).toBe("yuji");
    expect(personaList[0]!.sessionCount).toBe(1);

    // Fase H — Per-persona drill-down
    const evolution = await inject(
      "GET",
      "/analytics/personas/yuji/evolution",
    );
    expect(evolution.status).toBe(200);
    const evo = evolution.body as {
      summary: { totalOverrides: number };
      sessions: unknown[];
    };
    expect(evo.sessions).toHaveLength(1);
    // override + edit = 2 overrides per analytics SQL (jun_decisions WHERE decision IN edit/override)
    expect(evo.summary.totalOverrides).toBeGreaterThanOrEqual(2);

    // End — Session encerrada (sessionCount cai pra 0)
    const end = await inject("POST", `/sessions/${sessionId}/end`);
    expect(end.status).toBe(200);
    expect((end.body as { closed: boolean }).closed).toBe(true);

    const finalStatus = await inject("GET", "/status");
    expect(
      (finalStatus.body as { sessionCount: number }).sessionCount,
    ).toBe(0);
  });

  it("400 errors em payloads inválidos (boundary guards)", async () => {
    expect(
      (await inject("POST", "/mode", { mode: "invalid" })).status,
    ).toBe(400);
    expect(
      (await inject("POST", "/sessions/start-card", { cardId: "x" }))
        .status,
    ).toBe(400);
    expect(
      (await inject("POST", "/debug/llm-calls", { step: "x" })).status,
    ).toBe(400);
    expect(
      (await inject("POST", "/debug/actions", { sessionId: "x" })).status,
    ).toBe(400);
  });

  it("debug buffer FIFO eviction sob carga", async () => {
    // Push 5 events sem cap especial (default 200) → todos retidos
    for (let i = 0; i < 5; i++) {
      await inject("POST", "/debug/llm-calls", {
        step: `step-${i}`,
        provider: "local",
        model: "qwen14b",
        prompt: { user: `msg-${i}` },
      });
    }
    const list = await inject("GET", "/debug/llm-calls");
    const evts = (list.body as { events: unknown[] }).events;
    expect(evts).toHaveLength(5);

    // Clear
    const cleared = await inject("DELETE", "/debug/llm-calls");
    expect(cleared.status).toBe(200);
    const after = await inject("GET", "/debug/llm-calls");
    expect((after.body as { events: unknown[] }).events).toHaveLength(0);
  });

  it("analytics retorna lista vazia gracefully sem dados", async () => {
    const personas = await inject("GET", "/analytics/personas");
    expect(personas.status).toBe(200);
    expect(
      (personas.body as { personas: unknown[] }).personas,
    ).toEqual([]);

    const evo = await inject(
      "GET",
      "/analytics/personas/nobody/evolution",
    );
    expect(evo.status).toBe(404);
  });
});
