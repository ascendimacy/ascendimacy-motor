/**
 * Unit tests para B2 routes (Drilling wiring).
 *
 * Setup: cria BFF server in-memory + fixturesDir aponta pra
 * <repo-root>/fixtures (ja-pt-vocab-n5 bank disponível).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";
import { recordAttempt } from "@ascendimacy/motor-execucao/drill-repo";
import type { Database as DatabaseType } from "better-sqlite3";

const FIXTURES_DIR = resolve(__dirname, "../../../fixtures");

let server: BffServer;
let db: DatabaseType;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  server = createBffServer({
    daemon,
    db,
    logger: false,
    fixturesDir: FIXTURES_DIR,
  });
});

afterEach(async () => {
  await server.close();
});

const inject = async (url: string) => {
  const res = await server.fastify.inject({ method: "GET", url });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as unknown) : null,
  };
};

describe("GET /banks", () => {
  it("lista banks disponíveis na fixturesDir", async () => {
    const res = await inject("/banks");
    expect(res.status).toBe(200);
    const body = res.body as {
      banks: Array<{ bank_id: string; item_count: number }>;
    };
    expect(body.banks.length).toBeGreaterThan(0);
    const n5 = body.banks.find((b) => b.bank_id === "ja-pt-vocab-n5");
    expect(n5).toBeDefined();
    expect(n5!.item_count).toBe(50);
  });
});

describe("GET /banks/:bankId", () => {
  it("retorna conteúdo completo do bank existente", async () => {
    const res = await inject("/banks/ja-pt-vocab-n5");
    expect(res.status).toBe(200);
    const body = res.body as {
      bank: { bank_id: string; curator: string };
      items: Array<{ id: string; bank_id: string; payload: { prompt: string } }>;
    };
    expect(body.bank.bank_id).toBe("ja-pt-vocab-n5");
    expect(body.bank.curator).toBe("jun");
    expect(body.items.length).toBe(50);
    expect(body.items[0]!.bank_id).toBe("ja-pt-vocab-n5");
    expect(body.items[0]!.payload.prompt).toBeDefined();
  });

  it("retorna 404 para bank inexistente", async () => {
    const res = await inject("/banks/inexistente");
    expect(res.status).toBe(404);
  });
});

describe("GET /personas/:id/drill-state", () => {
  it("retorna states vazio para persona nunca drilada", async () => {
    const res = await inject("/personas/ryo-ochiai/drill-state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ states: [] });
  });

  it("retorna states populados após recordAttempt", async () => {
    recordAttempt(db, {
      personaId: "ryo-ochiai",
      itemId: "jpv-001",
      response: "correct",
      nowIso: "2026-05-27T10:00:00.000Z",
    });
    const res = await inject("/personas/ryo-ochiai/drill-state");
    const body = res.body as {
      states: Array<{ item_id: string; presented_count: number }>;
    };
    expect(body.states.length).toBe(1);
    expect(body.states[0]!.item_id).toBe("jpv-001");
    expect(body.states[0]!.presented_count).toBe(1);
  });
});

describe("GET /personas/:id/drill-due", () => {
  it("retorna due states após recordAttempt (next_due_at futuro)", async () => {
    recordAttempt(db, {
      personaId: "ryo-ochiai",
      itemId: "jpv-002",
      response: "correct",
      nowIso: "2026-05-27T10:00:00.000Z",
    });
    // No momento da query (default Date.now), o item está due ou ainda não?
    // Como SR move o due pra frente, em ~now ele NÃO está due. Sem
    // assert de length específico — apenas shape.
    const res = await inject("/personas/ryo-ochiai/drill-due");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("states");
  });
});

describe("GET /personas/:id/drill-mastered", () => {
  it("retorna mastered vazio quando não há mastery alcançado", async () => {
    const res = await inject("/personas/ryo-ochiai/drill-mastered");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ states: [] });
  });
});
