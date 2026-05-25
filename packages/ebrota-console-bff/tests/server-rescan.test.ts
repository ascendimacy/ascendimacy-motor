import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import {
  createMockDaemonClient,
  type MockDaemonClient,
} from "../src/daemon-client.js";
import { listSessionLibrary } from "../src/traces-scanner.js";

let server: BffServer;
let daemon: MockDaemonClient;
let db: DatabaseType;
let tmpRoot: string;

const writeTrace = (
  subdir: string,
  trace: Record<string, unknown>,
): string => {
  const dir = join(tmpRoot, subdir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "trace.json");
  writeFileSync(path, JSON.stringify(trace));
  return path;
};

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  daemon = createMockDaemonClient();
  tmpRoot = mkdtempSync(join(tmpdir(), "server-rescan-"));
});

afterEach(async () => {
  await server.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

const inject = async (method: "GET" | "POST", url: string) => {
  const res = await server.fastify.inject({ method, url });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null,
  };
};

describe("POST /rescan", () => {
  it("503 quando tracesDir não configurado", async () => {
    server = createBffServer({ daemon, db, logger: false });
    const res = await inject("POST", "/rescan");
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toMatch(/tracesDir/);
  });

  it("indexa novos traces que apareceram após startup", async () => {
    server = createBffServer({ daemon, db, logger: false, tracesDir: tmpRoot });

    // Estado inicial: zero sessions indexadas
    expect(listSessionLibrary(db)).toHaveLength(0);

    // STS deposita trace novo enquanto BFF roda
    writeTrace("session-novo", {
      sessionId: "kei__novo",
      persona: "kei",
      startedAt: "2026-05-25T10:00:00.000Z",
      turns: [
        {
          turnNumber: 0,
          incomingMessage: "card:test",
          finalResponse: "ok",
        },
      ],
    });

    const res = await inject("POST", "/rescan");
    expect(res.status).toBe(200);
    const body = res.body as {
      sessionsIndexed: number;
      filesScanned: number;
    };
    expect(body.sessionsIndexed).toBe(1);
    expect(body.filesScanned).toBe(1);

    const sessions = listSessionLibrary(db);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("kei__novo");
  });
});

describe("fs.watch auto-rescan", () => {
  it("re-indexa após novo .json aparecer no tracesDir (debounced)", async () => {
    server = createBffServer({ daemon, db, logger: false, tracesDir: tmpRoot });
    expect(listSessionLibrary(db)).toHaveLength(0);

    writeTrace("watched", {
      sessionId: "yuji__watched",
      persona: "yuji",
      startedAt: "2026-05-25T11:00:00.000Z",
      turns: [{ turnNumber: 0, finalResponse: "auto" }],
    });

    // Espera o debounce (1s) + margem pro scan async terminar
    await new Promise((r) => setTimeout(r, 1500));

    const sessions = listSessionLibrary(db);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((s) => s.sessionId === "yuji__watched")).toBe(true);
  });

  it("tracesDir inexistente não derruba o server (no-op)", async () => {
    const missingDir = join(tmpRoot, "does-not-exist");
    server = createBffServer({
      daemon,
      db,
      logger: false,
      tracesDir: missingDir,
    });
    // Endpoint ainda responde — scanTraces lida com dir ausente
    const res = await inject("POST", "/rescan");
    expect(res.status).toBe(200);
  });
});
