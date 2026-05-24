import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import {
  createMockDaemonClient,
  type MockDaemonClient,
} from "../src/daemon-client.js";
import { listRecentJunDecisions } from "../src/decisions.js";
import type { Database as DatabaseType } from "better-sqlite3";

let server: BffServer;
let daemon: MockDaemonClient;
let db: DatabaseType;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
});

afterEach(async () => {
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

describe("POST /sessions/:id/approve — jun_decisions persistence", () => {
  it("approve sem edição persiste decision=approve", async () => {
    daemon.setPendingApproval("sess-1", "original text");
    await inject("POST", "/sessions/sess-1/approve", {
      approved: true,
      originalText: "original text",
      turn: 2,
    });
    const decisions = listRecentJunDecisions(db, "sess-1");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("approve");
    expect(decisions[0]!.turn).toBe(2);
    expect(decisions[0]!.originalText).toBe("original text");
    expect(decisions[0]!.finalText).toBe("original text");
  });

  it("approve com editedText !== originalText persiste decision=edit", async () => {
    daemon.setPendingApproval("sess-1", "original");
    await inject("POST", "/sessions/sess-1/approve", {
      approved: true,
      editedText: "edited",
      originalText: "original",
      rationale: "tom mais leve",
    });
    const decisions = listRecentJunDecisions(db, "sess-1");
    expect(decisions[0]!.decision).toBe("edit");
    expect(decisions[0]!.originalText).toBe("original");
    expect(decisions[0]!.finalText).toBe("edited");
    expect(decisions[0]!.rationale).toBe("tom mais leve");
  });

  it("approved=false persiste decision=reject", async () => {
    daemon.setPendingApproval("sess-1", "x");
    await inject("POST", "/sessions/sess-1/approve", {
      approved: false,
      rationale: "tom errado",
    });
    const decisions = listRecentJunDecisions(db, "sess-1");
    expect(decisions[0]!.decision).toBe("reject");
    expect(decisions[0]!.rationale).toBe("tom errado");
  });

  it("NÃO persiste quando gateWasActive=false (sem pendente)", async () => {
    await inject("POST", "/sessions/sess-1/approve", { approved: true });
    expect(listRecentJunDecisions(db, "sess-1")).toHaveLength(0);
  });
});

describe("POST /sessions/:id/override — jun_decisions persistence", () => {
  it("override accepted=true persiste decision=override", async () => {
    daemon.setPendingPool("sess-1", [
      { item: { id: "card-a" }, score: 9 },
    ]);
    await inject("POST", "/sessions/sess-1/override", {
      contentItemId: "card-a",
      turn: 3,
      rationale: "melhor encaixe",
    });
    const decisions = listRecentJunDecisions(db, "sess-1");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("override");
    expect(decisions[0]!.overrideCardId).toBe("card-a");
    expect(decisions[0]!.turn).toBe(3);
    expect(decisions[0]!.rationale).toBe("melhor encaixe");
  });

  it("override rejected (id fora do pool) NÃO persiste", async () => {
    daemon.setPendingPool("sess-1", [
      { item: { id: "card-a" }, score: 9 },
    ]);
    await inject("POST", "/sessions/sess-1/override", {
      contentItemId: "nonexistent",
    });
    expect(listRecentJunDecisions(db, "sess-1")).toHaveLength(0);
  });

  it("override sem gate ativo NÃO persiste", async () => {
    await inject("POST", "/sessions/sess-1/override", {
      contentItemId: "x",
    });
    expect(listRecentJunDecisions(db, "sess-1")).toHaveLength(0);
  });
});

describe("GET /sessions/:id/decisions", () => {
  it("retorna decisions list pra session", async () => {
    daemon.setPendingApproval("sess-1", "x");
    await inject("POST", "/sessions/sess-1/approve", {
      approved: true,
      rationale: "ok",
    });
    daemon.setPendingApproval("sess-1", "y");
    await inject("POST", "/sessions/sess-1/approve", {
      approved: false,
      rationale: "no",
    });
    const res = await inject("GET", "/sessions/sess-1/decisions");
    expect(res.status).toBe(200);
    const body = res.body as { decisions: Array<{ decision: string }> };
    expect(body.decisions).toHaveLength(2);
    // Ordem DESC: reject (último) vem primeiro
    expect(body.decisions[0]!.decision).toBe("reject");
    expect(body.decisions[1]!.decision).toBe("approve");
  });

  it("limit query param respeitado", async () => {
    for (let i = 0; i < 5; i++) {
      daemon.setPendingApproval("sess-1", `x${i}`);
      await inject("POST", "/sessions/sess-1/approve", { approved: true });
    }
    const res = await inject("GET", "/sessions/sess-1/decisions?limit=2");
    const body = res.body as { decisions: unknown[] };
    expect(body.decisions).toHaveLength(2);
  });

  it("session sem decisions retorna lista vazia", async () => {
    const res = await inject("GET", "/sessions/no-data/decisions");
    expect(res.body).toEqual({ decisions: [] });
  });
});
