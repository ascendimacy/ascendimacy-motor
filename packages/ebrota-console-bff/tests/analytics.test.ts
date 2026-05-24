import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import {
  summarizePersonas,
  getPersonaEvolution,
} from "../src/analytics.js";
import { recordJunDecision } from "../src/decisions.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";

const insertSession = (
  db: DatabaseType,
  args: {
    sessionId: string;
    personaId: string;
    kind: "real" | "sts";
    startedAt: string;
    turnCount: number;
    hasOverrides?: boolean;
  },
): void => {
  db.prepare(
    `INSERT INTO sessions (
      session_id, persona_id, conversation_id, kind, started_at,
      turn_count, has_overrides, trace_path
    ) VALUES (@sessionId, @personaId, @sessionId, @kind, @startedAt,
      @turnCount, @hasOverrides, NULL)`,
  ).run({
    ...args,
    hasOverrides: args.hasOverrides ? 1 : 0,
  });
};

describe("summarizePersonas", () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = initDb({ dbPath: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("retorna array vazio quando não há sessions", () => {
    expect(summarizePersonas(db)).toEqual([]);
  });

  it("agrega session_count + turn_count por persona", () => {
    insertSession(db, {
      sessionId: "yuji__a",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 5,
    });
    insertSession(db, {
      sessionId: "yuji__b",
      personaId: "yuji",
      kind: "sts",
      startedAt: "2026-05-21T10:00:00.000Z",
      turnCount: 8,
    });
    insertSession(db, {
      sessionId: "kei__a",
      personaId: "kei",
      kind: "real",
      startedAt: "2026-05-22T10:00:00.000Z",
      turnCount: 3,
    });

    const summary = summarizePersonas(db);
    expect(summary).toHaveLength(2);
    const yuji = summary.find((s) => s.personaId === "yuji");
    const kei = summary.find((s) => s.personaId === "kei");
    expect(yuji?.sessionCount).toBe(2);
    expect(yuji?.realCount).toBe(1);
    expect(yuji?.stsCount).toBe(1);
    expect(yuji?.totalTurns).toBe(13);
    expect(kei?.sessionCount).toBe(1);
    expect(kei?.totalTurns).toBe(3);
  });

  it("conta overrides via jun_decisions", () => {
    insertSession(db, {
      sessionId: "yuji__a",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 10,
    });
    recordJunDecision(db, {
      sessionId: "yuji__a",
      turn: 1,
      decision: "override",
      overrideCardId: "card-x",
    });
    recordJunDecision(db, {
      sessionId: "yuji__a",
      turn: 3,
      decision: "edit",
      finalText: "edited",
    });
    recordJunDecision(db, {
      sessionId: "yuji__a",
      turn: 5,
      decision: "approve",
    });

    const summary = summarizePersonas(db);
    expect(summary[0]!.totalOverrides).toBe(2);
    expect(summary[0]!.overrideRate).toBeCloseTo(0.2, 3);
  });

  it("ordem por lastSessionAt DESC", () => {
    insertSession(db, {
      sessionId: "old",
      personaId: "kei",
      kind: "real",
      startedAt: "2026-04-01T10:00:00.000Z",
      turnCount: 1,
    });
    insertSession(db, {
      sessionId: "new",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-22T10:00:00.000Z",
      turnCount: 1,
    });
    const summary = summarizePersonas(db);
    expect(summary[0]!.personaId).toBe("yuji");
    expect(summary[1]!.personaId).toBe("kei");
  });

  it("override_rate é 0 quando totalTurns=0", () => {
    insertSession(db, {
      sessionId: "empty",
      personaId: "ryo",
      kind: "real",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 0,
    });
    expect(summarizePersonas(db)[0]!.overrideRate).toBe(0);
  });
});

describe("getPersonaEvolution", () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = initDb({ dbPath: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("retorna null pra persona inexistente", () => {
    expect(getPersonaEvolution(db, "nobody")).toBeNull();
  });

  it("retorna sessions ordenadas cronologicamente", () => {
    insertSession(db, {
      sessionId: "s3",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-22T10:00:00.000Z",
      turnCount: 4,
    });
    insertSession(db, {
      sessionId: "s1",
      personaId: "yuji",
      kind: "sts",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 6,
    });
    insertSession(db, {
      sessionId: "s2",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-21T10:00:00.000Z",
      turnCount: 2,
    });

    const evo = getPersonaEvolution(db, "yuji");
    expect(evo).not.toBeNull();
    expect(evo!.sessions.map((s) => s.sessionId)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("includes override_count per session", () => {
    insertSession(db, {
      sessionId: "yuji__a",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 5,
      hasOverrides: true,
    });
    recordJunDecision(db, {
      sessionId: "yuji__a",
      turn: 1,
      decision: "override",
      overrideCardId: "x",
    });
    recordJunDecision(db, {
      sessionId: "yuji__a",
      turn: 2,
      decision: "override",
      overrideCardId: "y",
    });

    const evo = getPersonaEvolution(db, "yuji");
    expect(evo!.sessions[0]!.overrideCount).toBe(2);
    expect(evo!.sessions[0]!.hasOverrides).toBe(true);
  });

  it("summary embedded coincide com summarizePersonas", () => {
    insertSession(db, {
      sessionId: "kei__a",
      personaId: "kei",
      kind: "real",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 7,
    });
    const evo = getPersonaEvolution(db, "kei");
    expect(evo!.summary.personaId).toBe("kei");
    expect(evo!.summary.totalTurns).toBe(7);
  });
});

describe("BFF analytics endpoints", () => {
  let server: BffServer;
  let db: DatabaseType;

  beforeEach(() => {
    db = initDb({ dbPath: ":memory:" });
    server = createBffServer({
      daemon: createMockDaemonClient(),
      db,
      logger: false,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const inject = async (url: string) => {
    const res = await server.fastify.inject({ method: "GET", url });
    return {
      status: res.statusCode,
      body: JSON.parse(res.body) as unknown,
    };
  };

  it("GET /analytics/personas retorna lista vazia inicialmente", async () => {
    const { status, body } = await inject("/analytics/personas");
    expect(status).toBe(200);
    expect(body).toEqual({ personas: [] });
  });

  it("GET /analytics/personas agrega corretamente", async () => {
    insertSession(db, {
      sessionId: "yuji__a",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 5,
    });
    const { body } = await inject("/analytics/personas");
    const personas = (body as { personas: Array<{ personaId: string }> })
      .personas;
    expect(personas).toHaveLength(1);
    expect(personas[0]!.personaId).toBe("yuji");
  });

  it("GET /analytics/personas/:id/evolution retorna 404 pra inexistente", async () => {
    const { status } = await inject("/analytics/personas/nobody/evolution");
    expect(status).toBe(404);
  });

  it("GET /analytics/personas/:id/evolution retorna sessions", async () => {
    insertSession(db, {
      sessionId: "yuji__a",
      personaId: "yuji",
      kind: "real",
      startedAt: "2026-05-20T10:00:00.000Z",
      turnCount: 3,
    });
    const { status, body } = await inject(
      "/analytics/personas/yuji/evolution",
    );
    expect(status).toBe(200);
    const evo = body as { sessions: unknown[]; summary: unknown };
    expect(evo.sessions).toHaveLength(1);
    expect(evo.summary).toBeDefined();
  });
});
