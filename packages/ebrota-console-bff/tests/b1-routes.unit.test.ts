/**
 * Unit tests para B1 routes (Camada Social wiring).
 *
 * Setup: cria BFF server in-memory + fixturesDir aponta pra
 * <repo-root>/fixtures (4 personas têm YAML).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";

const FIXTURES_DIR = resolve(__dirname, "../../../fixtures");

let server: BffServer;

beforeEach(() => {
  const db = initDb({ dbPath: ":memory:" });
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

describe("GET /personas/:id/temporal-windows", () => {
  it("retorna janela parseada para persona com fixture", async () => {
    const res = await inject("/personas/ryo-ochiai/temporal-windows");
    expect(res.status).toBe(200);
    const body = res.body as {
      persona_id: string;
      timezone: string;
      windows: Array<{ name: string }>;
    };
    expect(body.persona_id).toBe("ryo-ochiai");
    expect(body.timezone).toBe("Asia/Tokyo");
    expect(body.windows.length).toBeGreaterThan(0);
  });

  it("retorna 404 quando persona não tem fixture", async () => {
    const res = await inject("/personas/inexistente/temporal-windows");
    expect(res.status).toBe(404);
  });
});

describe("GET /personas/:id/pulso-events", () => {
  it("retorna events vazio (stub v0)", async () => {
    const res = await inject("/personas/ryo-ochiai/pulso-events");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
  });
});

describe("GET /personas/:id/sacrifice-budget", () => {
  it("retorna baseline + current + modifiers", async () => {
    const res = await inject("/personas/ryo-ochiai/sacrifice-budget");
    expect(res.status).toBe(200);
    const body = res.body as {
      baseline: number;
      current: number;
      mood: number;
      trust: number;
      modifiers: Array<{ label: string; active: boolean; delta: number }>;
      source: string;
    };
    expect(body.baseline).toBe(15);
    expect(body.current).toBe(15); // default mood=5, trust=0.5 → sem modifiers
    expect(body.modifiers.length).toBe(4);
    expect(body.modifiers.every((m) => m.active === false)).toBe(true);
    expect(body.source).toBe("stub_v0");
  });

  it("aplica modifier de mood alto via query", async () => {
    const res = await inject(
      "/personas/ryo-ochiai/sacrifice-budget?mood=8&trust=0.5",
    );
    const body = res.body as {
      current: number;
      modifiers: Array<{ active: boolean; delta: number }>;
    };
    expect(body.current).toBe(20); // 15 + 5
    expect(body.modifiers.find((m) => m.delta === 5)?.active).toBe(true);
  });

  it("aplica modifier de trust baixo via query", async () => {
    const res = await inject(
      "/personas/ryo-ochiai/sacrifice-budget?mood=5&trust=0.2",
    );
    const body = res.body as { current: number };
    expect(body.current).toBe(10); // 15 - 5
  });
});

describe("GET /personas/:id/cards", () => {
  it("retorna cards vazio para persona sem emissões", async () => {
    const res = await inject("/personas/ryo-ochiai/cards");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cards: [] });
  });
});

describe("GET /personas/:id/dyad", () => {
  it("retorna dyad null (stub v0)", async () => {
    const res = await inject("/personas/ryo-ochiai/dyad");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dyad: null, source: "stub_v0" });
  });
});
