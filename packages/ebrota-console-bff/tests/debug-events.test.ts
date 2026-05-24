import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import {
  createDebugEventsStore,
  recordDebugAction,
  type LlmCallEventPayload,
} from "../src/debug-events.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";

const samplePayload = (): LlmCallEventPayload => ({
  step: "planejador.plan_turn",
  provider: "anthropic",
  model: "claude-opus-4",
  prompt: {
    system: "You are Brota...",
    user: "card:tabuada-7",
  },
  params: { temperature: 0.7, maxTokens: 800 },
  sessionId: "yuji__a",
  turn: 0,
});

describe("createDebugEventsStore", () => {
  it("push retorna event com id + receivedAt", () => {
    const store = createDebugEventsStore({
      now: () => "2026-05-24T13:00:00.000Z",
    });
    const ev = store.push(samplePayload());
    expect(ev.id).toBe(1);
    expect(ev.receivedAt).toBe("2026-05-24T13:00:00.000Z");
    expect(ev.step).toBe("planejador.plan_turn");
  });

  it("id incrementa monotonicamente", () => {
    const store = createDebugEventsStore();
    expect(store.push(samplePayload()).id).toBe(1);
    expect(store.push(samplePayload()).id).toBe(2);
    expect(store.push(samplePayload()).id).toBe(3);
  });

  it("since retorna events com id > sinceId", () => {
    const store = createDebugEventsStore();
    store.push(samplePayload());
    store.push(samplePayload());
    store.push(samplePayload());
    expect(store.since(0)).toHaveLength(3);
    expect(store.since(1)).toHaveLength(2);
    expect(store.since(3)).toHaveLength(0);
  });

  it("cap respeitado, eviction FIFO", () => {
    const store = createDebugEventsStore({ cap: 3 });
    store.push(samplePayload());
    store.push(samplePayload());
    store.push(samplePayload());
    store.push(samplePayload());
    store.push(samplePayload());
    expect(store.snapshot()).toHaveLength(3);
    expect(store.snapshot()[0]!.id).toBe(3);
    expect(store.snapshot()[2]!.id).toBe(5);
    expect(store.totalEmitted()).toBe(5);
  });

  it("clear esvazia buffer mas total preserva", () => {
    const store = createDebugEventsStore();
    store.push(samplePayload());
    store.push(samplePayload());
    store.clear();
    expect(store.snapshot()).toHaveLength(0);
    expect(store.totalEmitted()).toBe(2);
  });
});

describe("recordDebugAction", () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = initDb({ dbPath: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("persiste action em debug_actions", () => {
    const res = recordDebugAction(db, {
      sessionId: "s1",
      action: "tail",
      llmCallId: "1",
      originalPromptHash: "abc123",
    });
    expect("id" in res).toBe(true);
    const row = db
      .prepare("SELECT * FROM debug_actions WHERE id = ?")
      .get(("id" in res ? res.id : 0)) as Record<string, unknown>;
    expect(row["session_id"]).toBe("s1");
    expect(row["action"]).toBe("tail");
  });

  it("action constraint enforced via schema (qualquer string aceita; check no schema é por CHECK lógico)", () => {
    // Schema tem CHECK pra junreddecision; debug_actions não. Apenas
    // verificamos que NULL é OK pra campos opcionais.
    const res = recordDebugAction(db, {
      sessionId: "s2",
      action: "approve",
    });
    expect("id" in res).toBe(true);
  });
});

describe("BFF debug endpoints", () => {
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

  const inject = async (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) => {
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

  it("POST /debug/llm-calls push event + retorna id", async () => {
    const res = await inject("POST", "/debug/llm-calls", samplePayload());
    expect(res.status).toBe(200);
    expect((res.body as { id: number }).id).toBe(1);
  });

  it("POST /debug/llm-calls 400 sem campos obrigatórios", async () => {
    const res = await inject("POST", "/debug/llm-calls", { step: "x" });
    expect(res.status).toBe(400);
  });

  it("GET /debug/llm-calls retorna snapshot + totalEmitted", async () => {
    await inject("POST", "/debug/llm-calls", samplePayload());
    await inject("POST", "/debug/llm-calls", samplePayload());
    const res = await inject("GET", "/debug/llm-calls");
    expect(res.status).toBe(200);
    const body = res.body as {
      events: Array<{ id: number }>;
      totalEmitted: number;
    };
    expect(body.events).toHaveLength(2);
    expect(body.totalEmitted).toBe(2);
  });

  it("GET /debug/llm-calls?sinceId=N filtra", async () => {
    await inject("POST", "/debug/llm-calls", samplePayload());
    await inject("POST", "/debug/llm-calls", samplePayload());
    const res = await inject("GET", "/debug/llm-calls?sinceId=1");
    const body = res.body as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it("DELETE /debug/llm-calls limpa buffer", async () => {
    await inject("POST", "/debug/llm-calls", samplePayload());
    await inject("DELETE", "/debug/llm-calls");
    const res = await inject("GET", "/debug/llm-calls");
    expect((res.body as { events: unknown[] }).events).toHaveLength(0);
  });

  it("POST /debug/actions persiste em debug_actions", async () => {
    const res = await inject("POST", "/debug/actions", {
      sessionId: "s1",
      action: "tail",
      llmCallId: "5",
    });
    expect(res.status).toBe(200);
    const row = db
      .prepare(
        "SELECT * FROM debug_actions WHERE session_id = 's1'",
      )
      .get() as { action: string } | undefined;
    expect(row?.action).toBe("tail");
  });

  it("POST /debug/actions 400 sem sessionId ou action", async () => {
    const res = await inject("POST", "/debug/actions", {});
    expect(res.status).toBe(400);
  });
});
