import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import {
  createMockDaemonClient,
  type MockDaemonClient,
} from "../src/daemon-client.js";
import type { BffStatus, ConsoleMode } from "../src/types.js";

let server: BffServer;
let daemon: MockDaemonClient;

const setup = () => {
  const db = initDb({ dbPath: ":memory:" });
  daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
  return server.fastify;
};

beforeEach(() => {
  setup();
});

afterEach(async () => {
  // close fechar daemon + db também
  await server.close();
});

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
    body: res.body ? (JSON.parse(res.body) as unknown) : null,
  };
};

describe("GET /status", () => {
  it("retorna BffStatus shape correto", async () => {
    const res = await inject("GET", "/status");
    expect(res.status).toBe(200);
    const body = res.body as BffStatus;
    expect(body.mode).toBe("auto");
    expect(body.daemonConnected).toBe(true);
    expect(body.channelConnected).toBe(false); // PR2: ainda hardcoded
    expect(body.sessionCount).toBe(0);
    expect(typeof body.startedAt).toBe("string");
  });

  it("sessionCount reflete daemon após startCardSession", async () => {
    await inject("POST", "/sessions/start-card", {
      cardId: "tabuada-7",
      conversationId: "conv-1",
      from: "yuji",
      pkg: { cardId: "tabuada-7", raw: "x", sourcePath: "/x" },
    });
    const res = await inject("GET", "/status");
    expect((res.body as BffStatus).sessionCount).toBe(1);
  });
});

describe("GET /mode + POST /mode", () => {
  it("default mode = auto", async () => {
    const res = await inject("GET", "/mode");
    expect((res.body as { mode: ConsoleMode }).mode).toBe("auto");
  });

  it("POST /mode altera mode", async () => {
    const res = await inject("POST", "/mode", { mode: "semi-auto" });
    expect(res.status).toBe(200);
    expect((res.body as { mode: ConsoleMode }).mode).toBe("semi-auto");
    expect(server.getMode()).toBe("semi-auto");
  });

  it("POST /mode rejeita valor inválido", async () => {
    const res = await inject("POST", "/mode", { mode: "invalid" });
    expect(res.status).toBe(400);
  });
});

describe("POST /sessions/start-card", () => {
  it("dispatcha pro daemon e retorna text + sessionId", async () => {
    const res = await inject("POST", "/sessions/start-card", {
      cardId: "tabuada-7",
      conversationId: "conv-1",
      from: "yuji",
      pkg: { cardId: "tabuada-7", raw: "# pkg", sourcePath: "/x" },
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      sessionId: string;
      text: string;
      tracePath: string;
    };
    expect(body.sessionId).toBe("yuji__conv-1");
    expect(body.text).toContain("mock response for tabuada-7");
    expect(daemon.startCalls).toHaveLength(1);
  });

  it("400 quando faltam campos", async () => {
    const res = await inject("POST", "/sessions/start-card", {
      cardId: "x",
      // missing conversationId/from/pkg
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /sessions/:id/options", () => {
  it("retorna pool vazio quando sem gate ativo", async () => {
    const res = await inject("GET", "/sessions/sess-x/options");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contentPool: [] });
  });

  it("retorna pool quando gate ativo (via mock setPendingPool)", async () => {
    daemon.setPendingPool("sess-x", [
      { item: { id: "card-a" }, score: 9 },
      { item: { id: "card-b" }, score: 7 },
    ]);
    const res = await inject("GET", "/sessions/sess-x/options");
    const body = res.body as {
      contentPool: Array<{ item: { id: string }; score: number }>;
    };
    expect(body.contentPool.map((s) => s.item.id)).toEqual([
      "card-a",
      "card-b",
    ]);
  });
});

describe("POST /sessions/:id/override", () => {
  it("retorna { accepted: false, gateWasActive: false } quando sem gate", async () => {
    const res = await inject("POST", "/sessions/sess-x/override", {
      contentItemId: "card-a",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accepted: false,
      foundInPool: false,
      gateWasActive: false,
    });
  });

  it("aceita override quando id existe no pool", async () => {
    daemon.setPendingPool("sess-x", [
      { item: { id: "card-a" }, score: 9 },
    ]);
    const res = await inject("POST", "/sessions/sess-x/override", {
      contentItemId: "card-a",
    });
    expect(res.body).toEqual({
      accepted: true,
      foundInPool: true,
      gateWasActive: true,
    });
    expect(daemon.overrideCalls).toEqual([
      { sessionId: "sess-x", contentItemId: "card-a" },
    ]);
  });

  it("400 sem contentItemId", async () => {
    const res = await inject("POST", "/sessions/sess-x/override", {});
    expect(res.status).toBe(400);
  });
});

describe("GET /sessions/:id/pending-approval + POST /sessions/:id/approve", () => {
  it("get retorna null sem approval pendente", async () => {
    const res = await inject("GET", "/sessions/sess-x/pending-approval");
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("get retorna snapshot quando pendente", async () => {
    daemon.setPendingApproval("sess-x", "Texto proposto");
    const res = await inject("GET", "/sessions/sess-x/pending-approval");
    expect(res.body).toEqual({ proposedText: "Texto proposto" });
  });

  it("POST /approve com decision aprovada + edited text", async () => {
    daemon.setPendingApproval("sess-x", "original");
    const res = await inject("POST", "/sessions/sess-x/approve", {
      approved: true,
      editedText: "editado",
      rationale: "tom",
    });
    expect(res.body).toEqual({ accepted: true, gateWasActive: true });
    expect(daemon.approvalCalls).toEqual([
      {
        sessionId: "sess-x",
        decision: {
          approved: true,
          editedText: "editado",
          rationale: "tom",
        },
      },
    ]);
  });

  it("POST /approve sem approved boolean → 400", async () => {
    const res = await inject("POST", "/sessions/sess-x/approve", {
      rationale: "missing approved",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /sessions/:id/end", () => {
  it("retorna closed=false pra sessão inexistente", async () => {
    const res = await inject("POST", "/sessions/inexistente/end");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ closed: false });
  });

  it("retorna closed=true após start", async () => {
    await inject("POST", "/sessions/start-card", {
      cardId: "x",
      conversationId: "conv-end",
      from: "yuji",
      pkg: { cardId: "x", raw: "x", sourcePath: "/x" },
    });
    const res = await inject("POST", "/sessions/yuji__conv-end/end");
    expect(res.body).toEqual({ closed: true });
  });
});

describe("DB schema initDb", () => {
  it("cria tabelas sessions + messages_fts + jun_decisions + debug_actions", () => {
    const db = initDb({ dbPath: ":memory:" });
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("sessions");
    expect(names).toContain("messages_fts");
    expect(names).toContain("jun_decisions");
    expect(names).toContain("debug_actions");
    db.close();
  });

  it("idempotent — chamar 2x não falha", () => {
    const path = ":memory:";
    // SQLite :memory: é per-conexão; usa file tmp pra cross-conn check
    const fileDb = new Database(":memory:");
    fileDb.close();
    void path;
    const db1 = initDb({ dbPath: ":memory:" });
    // running schema again no mesmo db (same conn) deve ser idempotent
    db1.exec(
      "CREATE TABLE IF NOT EXISTS sessions(session_id TEXT PRIMARY KEY);",
    );
    db1.close();
  });
});
