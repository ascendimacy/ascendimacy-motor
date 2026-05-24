import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";

let server: BffServer;
let db: DatabaseType;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  server = createBffServer({
    daemon,
    db,
    logger: false,
    uiBaseUrl: "http://localhost:5173",
  });
});

afterEach(async () => {
  await server.close();
});

describe("GET /replay/:id — redirect pro UI", () => {
  it("302 redirect com query ?replay=ID", async () => {
    const res = await server.fastify.inject({
      method: "GET",
      url: "/replay/yuji__a",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toBe(
      "http://localhost:5173/?replay=yuji__a",
    );
  });

  it("encoda sessionId com special chars", async () => {
    const res = await server.fastify.inject({
      method: "GET",
      url: "/replay/yuji__5511%40s.whatsapp.net",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toContain(
      "%40s.whatsapp.net",
    );
  });
});

describe("GET /live/:id — redirect pro UI", () => {
  it("302 redirect com query ?live=ID", async () => {
    const res = await server.fastify.inject({
      method: "GET",
      url: "/live/sess-x",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toBe(
      "http://localhost:5173/?live=sess-x",
    );
  });
});

describe("uiBaseUrl custom (deploy ou test override)", () => {
  it("respeita opts.uiBaseUrl", async () => {
    await server.close();
    const daemon = createMockDaemonClient();
    server = createBffServer({
      daemon,
      db: initDb({ dbPath: ":memory:" }),
      logger: false,
      uiBaseUrl: "https://console.ebrota.example.com",
    });
    const res = await server.fastify.inject({
      method: "GET",
      url: "/replay/x",
    });
    expect(res.headers["location"]).toBe(
      "https://console.ebrota.example.com/?replay=x",
    );
  });
});
