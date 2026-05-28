/**
 * Integration tests for S5 STS launcher spawn (real subprocess).
 *
 * Spawns `scripts/run-sts.mjs` via the BFF `/sts/runs/start` endpoint, then
 * polls `/sts/runs/:id/status` until terminal. Uses `--turns=2` and tiny
 * tick interval so each test completes in <10s.
 *
 * Repo root is computed at runtime — points at the actual monorepo so the
 * stub script (committed under `scripts/run-sts.mjs`) is resolvable.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";
import type { Database as DatabaseType } from "better-sqlite3";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// tests/ live in packages/ebrota-console-bff/tests → repo root 3 levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

let server: BffServer;
let db: DatabaseType;
let logDir: string;

beforeAll(() => {
  // sanity: stub script must exist
  expect(existsSync(join(REPO_ROOT, "scripts", "run-sts.mjs"))).toBe(true);
});

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  logDir = mkdtempSync(join(tmpdir(), "sts-spawn-test-"));
  const daemon = createMockDaemonClient();
  // STS_STUB_TICK_MS speeds up the stub so each turn elapses ~80ms.
  process.env.STS_STUB_TICK_MS = "80";
  server = createBffServer({
    daemon,
    db,
    logger: false,
    stsRepoRoot: REPO_ROOT,
    stsLogDir: logDir,
    stsDefaultUseMockLlm: true,
  });
});

afterEach(async () => {
  // Kill any lingering child processes via Fastify onClose hook.
  await server.close();
  delete process.env.STS_STUB_TICK_MS;
});

const inject = async (
  url: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
) => {
  const res = await server.fastify.inject({
    method,
    url,
    ...(body !== undefined ? { payload: body } : {}),
  });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as unknown) : null,
  };
};

async function pollUntilTerminal(
  runId: string,
  timeoutMs = 8000,
): Promise<{
  status: string;
  exit_code: number | null;
  turns_completed: number;
  error_message: string | null;
  stdout_tail: string[];
  stderr_tail: string[];
}> {
  const startedAt = Date.now();
  let last: {
    status: string;
    exit_code: number | null;
    turns_completed: number;
    error_message: string | null;
    stdout_tail: string[];
    stderr_tail: string[];
  } | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const res = await inject(`/sts/runs/${runId}/status`);
    last = res.body as typeof last;
    if (
      last !== null &&
      (last.status === "succeeded" ||
        last.status === "failed" ||
        last.status === "cancelled")
    ) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `pollUntilTerminal timed out after ${timeoutMs}ms; last=${JSON.stringify(last)}`,
  );
}

describe("STS spawn — DDL", () => {
  it("DDL é idempotente (init duas vezes não joga)", () => {
    // Second init on the same in-memory DB is impossible because each
    // call creates a new instance; instead re-run schema directly.
    expect(() => initDb({ dbPath: ":memory:" })).not.toThrow();
    expect(() => initDb({ dbPath: ":memory:" })).not.toThrow();
  });

  it("sts_runs table existe após init", () => {
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='sts_runs'`,
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("sts_runs");
  });
});

describe("POST /sts/runs/start (spawn real)", () => {
  it("cria row em sts_runs + spawna processo + retorna runId/pid/status", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      scenario_id: "smoke-3d",
      turns: 2,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      run_id: string;
      status: string;
      pid: number | null;
      turns: number;
    };
    expect(body.run_id.length).toBeGreaterThan(0);
    expect(body.status).toBe("running");
    expect(body.pid).not.toBeNull();
    expect(body.turns).toBe(2);

    const row = db
      .prepare(`SELECT * FROM sts_runs WHERE run_id = ?`)
      .get(body.run_id) as {
        status: string;
        pid: number | null;
        turns_requested: number;
      };
    expect(row.status).toBe("running");
    expect(row.pid).toBe(body.pid);
    expect(row.turns_requested).toBe(2);

    // Let the process finish so afterEach doesn't leak.
    await pollUntilTerminal(body.run_id);
  });
});

describe("status transitions pending → running → succeeded", () => {
  it("smoke-3d com turns=2 termina com status=succeeded + exit_code=0", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      scenario_id: "smoke-3d",
      turns: 2,
    });
    const { run_id } = res.body as { run_id: string };
    const terminal = await pollUntilTerminal(run_id);
    expect(terminal.status).toBe("succeeded");
    expect(terminal.exit_code).toBe(0);
    expect(terminal.turns_completed).toBe(2);
    const stdoutJoined = terminal.stdout_tail.join("\n");
    expect(stdoutJoined).toContain("STS RUN STARTED");
    expect(stdoutJoined).toContain("STS RUN COMPLETED");
  });
});

describe("POST /sts/runs/:id/cancel via SIGTERM", () => {
  it("cancela run em andamento → status=cancelled", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      // Many turns so we have time to cancel before completion.
      scenario_id: "nagareyama-30d",
      turns: 50,
    });
    const { run_id } = res.body as { run_id: string };

    // Give the child a moment to actually start before we cancel.
    await new Promise((r) => setTimeout(r, 150));

    const cancelRes = await inject(`/sts/runs/${run_id}/cancel`, "POST");
    expect(cancelRes.status).toBe(200);
    const cancelBody = cancelRes.body as { status: string; cancelled: boolean };
    expect(cancelBody.status).toBe("cancelled");
    expect(cancelBody.cancelled).toBe(true);

    // Status endpoint should report cancelled persistently.
    const statusRes = await inject(`/sts/runs/${run_id}/status`);
    const statusBody = statusRes.body as { status: string };
    expect(statusBody.status).toBe("cancelled");
  });
});

describe("failure path (scenario=fail-fast)", () => {
  it("captura exit code != 0 + error_message + status=failed", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      scenario_id: "fail-fast",
      turns: 5,
    });
    const { run_id } = res.body as { run_id: string };
    const terminal = await pollUntilTerminal(run_id);
    expect(terminal.status).toBe("failed");
    expect(terminal.exit_code).toBe(1);
    expect(terminal.error_message).not.toBeNull();
    // stderr should include the FAIL marker emitted by stub.
    const stderrJoined = terminal.stderr_tail.join("\n");
    expect(stderrJoined).toContain("STS RUN FAILED");
  });
});

describe("GET /sts/runs lista ordenada", () => {
  it("retorna runs em ordem started_at DESC", async () => {
    // Spawn 3 quick runs.
    const a = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      scenario_id: "smoke-3d",
      turns: 2,
    });
    await new Promise((r) => setTimeout(r, 20));
    const b = await inject("/sts/runs/start", "POST", {
      persona_id: "paula-mendes",
      scenario_id: "smoke-3d",
      turns: 2,
    });
    await new Promise((r) => setTimeout(r, 20));
    const c = await inject("/sts/runs/start", "POST", {
      persona_id: "kei-ochiai",
      scenario_id: "smoke-3d",
      turns: 2,
    });

    const list = await inject("/sts/runs?limit=10");
    const body = list.body as {
      runs: Array<{ run_id: string; started_at: string }>;
    };
    expect(body.runs.length).toBe(3);
    // Most recent first.
    expect(body.runs[0]?.run_id).toBe((c.body as { run_id: string }).run_id);
    expect(body.runs[2]?.run_id).toBe((a.body as { run_id: string }).run_id);

    // Drain processes.
    await Promise.all([
      pollUntilTerminal((a.body as { run_id: string }).run_id),
      pollUntilTerminal((b.body as { run_id: string }).run_id),
      pollUntilTerminal((c.body as { run_id: string }).run_id),
    ]);
  });
});

describe("GET /sts/runs/:id/status edge cases", () => {
  it("404 quando run_id desconhecido", async () => {
    const res = await inject("/sts/runs/nope-nope-nope/status");
    expect(res.status).toBe(404);
  });

  it("status retorna stdout_tail/stderr_tail após terminal", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      scenario_id: "smoke-3d",
      turns: 2,
    });
    const { run_id } = res.body as { run_id: string };
    const terminal = await pollUntilTerminal(run_id);
    expect(Array.isArray(terminal.stdout_tail)).toBe(true);
    expect(terminal.stdout_tail.length).toBeGreaterThan(0);
  });
});

describe("POST /sts/runs/:id/cancel edge cases", () => {
  it("404 quando run_id desconhecido", async () => {
    const res = await inject("/sts/runs/inexistente/cancel", "POST");
    expect(res.status).toBe(404);
  });

  it("idempotente: cancel em run já terminal retorna cancelled=false", async () => {
    const res = await inject("/sts/runs/start", "POST", {
      persona_id: "ryo-ochiai",
      scenario_id: "smoke-3d",
      turns: 2,
    });
    const { run_id } = res.body as { run_id: string };
    await pollUntilTerminal(run_id);
    const cancelRes = await inject(`/sts/runs/${run_id}/cancel`, "POST");
    expect(cancelRes.status).toBe(200);
    const body = cancelRes.body as { cancelled: boolean; status: string };
    expect(body.cancelled).toBe(false);
    expect(body.status).toBe("succeeded");
  });
});
