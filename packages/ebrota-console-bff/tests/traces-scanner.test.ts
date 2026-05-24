import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import {
  listSessionLibrary,
  readSessionTrace,
  scanTraces,
} from "../src/traces-scanner.js";

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
  tmpRoot = mkdtempSync(join(tmpdir(), "traces-scanner-"));
});

afterEach(() => {
  db.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("scanTraces", () => {
  it("indexa traces recursivamente", async () => {
    writeTrace("session-1", {
      sessionId: "yuji__conv-1",
      persona: "yuji",
      startedAt: "2026-05-24T13:00:00.000Z",
      turns: [
        {
          turnNumber: 0,
          incomingMessage: "card:tabuada-7",
          finalResponse: "Vamos lá Yuji!",
        },
      ],
    });
    writeTrace("session-2/deep/nested", {
      sessionId: "kei__conv-2",
      persona: "kei",
      startedAt: "2026-05-24T14:00:00.000Z",
      turns: [],
    });

    const result = await scanTraces({ tracesDir: tmpRoot, db });
    expect(result.filesScanned).toBe(2);
    expect(result.sessionsIndexed).toBe(2);
    expect(result.errors).toHaveLength(0);

    const sessions = listSessionLibrary(db);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.sessionId).sort()).toEqual([
      "kei__conv-2",
      "yuji__conv-1",
    ]);
  });

  it("popula messages_fts com finalResponse + incomingMessage", async () => {
    writeTrace("s1", {
      sessionId: "yuji__conv-fts",
      persona: "yuji",
      startedAt: "2026-05-24T13:00:00.000Z",
      turns: [
        {
          turnNumber: 0,
          incomingMessage: "card:tabuada-frutas-vermelhas",
          finalResponse: "Vamos descobrir frutas vermelhas como morango!",
        },
        {
          turnNumber: 1,
          incomingMessage: "morango é minha favorita",
          finalResponse: "Que bom!",
        },
      ],
    });

    await scanTraces({ tracesDir: tmpRoot, db });

    // FTS5 search
    const rows = db
      .prepare(
        "SELECT session_id, text FROM messages_fts WHERE text MATCH ? ORDER BY turn",
      )
      .all("morango") as Array<{ session_id: string; text: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.text.includes("morango"))).toBe(true);
  });

  it("idempotent — re-scan substitui rows", async () => {
    const tracePath = writeTrace("s1", {
      sessionId: "yuji__idem",
      persona: "yuji",
      startedAt: "2026-05-24T13:00:00.000Z",
      turns: [{ turnNumber: 0, finalResponse: "v1" }],
    });
    await scanTraces({ tracesDir: tmpRoot, db });
    let sessions = listSessionLibrary(db);
    expect(sessions[0]!.turnCount).toBe(1);

    // Update trace + re-scan
    writeFileSync(
      tracePath,
      JSON.stringify({
        sessionId: "yuji__idem",
        persona: "yuji",
        startedAt: "2026-05-24T13:00:00.000Z",
        turns: [
          { turnNumber: 0, finalResponse: "v1" },
          { turnNumber: 1, finalResponse: "v2" },
        ],
      }),
    );
    await scanTraces({ tracesDir: tmpRoot, db });
    sessions = listSessionLibrary(db);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.turnCount).toBe(2);
  });

  it("dir inexistente → result vazio sem error", async () => {
    const result = await scanTraces({
      tracesDir: "/nonexistent/path/zzz",
      db,
    });
    expect(result).toEqual({
      filesScanned: 0,
      sessionsIndexed: 0,
      turnsIndexed: 0,
      messagesIndexed: 0,
      errors: [],
    });
  });

  it("trace JSON malformado → error registrado, continua scan", async () => {
    writeFileSync(
      join(tmpRoot, "trace.json"),
      "not valid json {{{",
    );
    writeTrace("good", {
      sessionId: "good__1",
      persona: "good",
      startedAt: "2026-05-24T13:00:00.000Z",
      turns: [],
    });
    const result = await scanTraces({ tracesDir: tmpRoot, db });
    expect(result.errors.length).toBe(1);
    expect(result.sessionsIndexed).toBe(1);
  });

  it("kind inferido como 'sts' quando sessionId começa com 'sts-'", async () => {
    writeTrace("a", {
      sessionId: "sts-yuji-001",
      persona: "yuji",
      startedAt: "2026-05-24T13:00:00.000Z",
      turns: [],
    });
    writeTrace("b", {
      sessionId: "yuji__real-conv",
      persona: "yuji",
      startedAt: "2026-05-24T14:00:00.000Z",
      turns: [],
    });
    await scanTraces({ tracesDir: tmpRoot, db });
    const sessions = listSessionLibrary(db);
    const sts = sessions.find((s) => s.kind === "sts");
    const real = sessions.find((s) => s.kind === "real");
    expect(sts?.sessionId).toBe("sts-yuji-001");
    expect(real?.sessionId).toBe("yuji__real-conv");
  });
});

describe("listSessionLibrary filters", () => {
  beforeEach(async () => {
    // Setup pré-populado: 3 sessões
    writeTrace("a", {
      sessionId: "yuji__a",
      persona: "yuji",
      startedAt: "2026-05-20T10:00:00.000Z",
      turns: [{ turnNumber: 0, finalResponse: "morango doce" }],
    });
    writeTrace("b", {
      sessionId: "kei__b",
      persona: "kei",
      startedAt: "2026-05-22T10:00:00.000Z",
      turns: [{ turnNumber: 0, finalResponse: "frutas amargas" }],
    });
    writeTrace("c", {
      sessionId: "sts-yuji-c",
      persona: "yuji",
      startedAt: "2026-05-23T10:00:00.000Z",
      turns: [{ turnNumber: 0, finalResponse: "tabuada" }],
    });
    await scanTraces({ tracesDir: tmpRoot, db });
  });

  it("filter por persona", () => {
    expect(
      listSessionLibrary(db, { persona: "yuji" }).map((s) => s.sessionId).sort(),
    ).toEqual(["sts-yuji-c", "yuji__a"]);
  });

  it("filter por kind", () => {
    expect(
      listSessionLibrary(db, { kind: "real" }).map((s) => s.sessionId).sort(),
    ).toEqual(["kei__b", "yuji__a"]);
    expect(
      listSessionLibrary(db, { kind: "sts" }).map((s) => s.sessionId),
    ).toEqual(["sts-yuji-c"]);
  });

  it("filter por date range", () => {
    expect(
      listSessionLibrary(db, {
        fromIso: "2026-05-22T00:00:00.000Z",
      }).map((s) => s.sessionId).sort(),
    ).toEqual(["kei__b", "sts-yuji-c"]);
    expect(
      listSessionLibrary(db, {
        toIso: "2026-05-21T00:00:00.000Z",
      }).map((s) => s.sessionId),
    ).toEqual(["yuji__a"]);
  });

  it("full-text search q via FTS5", () => {
    expect(
      listSessionLibrary(db, { q: "morango" }).map((s) => s.sessionId),
    ).toEqual(["yuji__a"]);
    expect(
      listSessionLibrary(db, { q: "frutas" }).map((s) => s.sessionId),
    ).toEqual(["kei__b"]);
  });

  it("filter combinado (persona + kind)", () => {
    expect(
      listSessionLibrary(db, { persona: "yuji", kind: "real" }).map(
        (s) => s.sessionId,
      ),
    ).toEqual(["yuji__a"]);
  });

  it("ORDER BY started_at DESC", () => {
    const all = listSessionLibrary(db);
    expect(all.map((s) => s.sessionId)).toEqual([
      "sts-yuji-c",
      "kei__b",
      "yuji__a",
    ]);
  });

  it("limit respeitado", () => {
    expect(listSessionLibrary(db, { limit: 2 }).length).toBe(2);
  });
});

describe("readSessionTrace", () => {
  it("retorna trace JSON full", async () => {
    writeTrace("a", {
      sessionId: "yuji__a",
      persona: "yuji",
      startedAt: "2026-05-24T13:00:00.000Z",
      turns: [{ turnNumber: 0, finalResponse: "olá" }],
    });
    await scanTraces({ tracesDir: tmpRoot, db });
    const trace = await readSessionTrace(db, "yuji__a");
    expect(trace).not.toBeNull();
    expect(trace!.sessionId).toBe("yuji__a");
    expect(trace!.turns).toHaveLength(1);
  });

  it("sessionId desconhecido → null", async () => {
    const trace = await readSessionTrace(db, "nonexistent");
    expect(trace).toBeNull();
  });
});
