/**
 * Tests end-to-end Fase 2: trace com subjectKnowledgeEvents →
 * scanner indexa → repo retorna via API.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database as DatabaseType } from "better-sqlite3";
import { initDb } from "../src/db.js";
import { scanTraces } from "../src/traces-scanner.js";
import {
  listSubjectDiscoveries,
  listBoundaryEvents,
  summarizeBoundariesByCategory,
} from "../src/subject-knowledge-repo.js";
import {
  createBffServer,
  type BffServer,
} from "../src/server.js";
import {
  createMockDaemonClient,
  type MockDaemonClient,
} from "../src/daemon-client.js";

let db: DatabaseType;
let tmpRoot: string;
let server: BffServer;
let daemon: MockDaemonClient;

beforeEach(() => {
  db = initDb({ dbPath: ":memory:" });
  daemon = createMockDaemonClient();
  server = createBffServer({ daemon, db, logger: false });
  tmpRoot = mkdtempSync(join(tmpdir(), "sk-pipeline-"));
});

afterEach(async () => {
  await server.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

const writeTrace = (subdir: string, trace: Record<string, unknown>): string => {
  const dir = join(tmpRoot, subdir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "trace.json");
  writeFileSync(path, JSON.stringify(trace));
  return path;
};

const fakeInterestEvent = (sessionId: string, turnRef: string, label: string) => ({
  id: `sk-ev-${turnRef}-${label}`,
  subject_id: "ryo",
  type: "interest",
  source: "self_declared",
  confidence: 0.85,
  confirmed_at: turnRef,
  alignment: "unknown",
  payload: { kind: "interest", label, intensity: "mid" },
  turn_ref: turnRef,
  session_id: sessionId,
  created_at: "2026-05-25T10:00:00.000Z",
});

const fakeBoundaryEvent = (
  sessionId: string,
  turnRef: string,
  signalType: string,
  topicCategory: string,
  intensity = "mid",
) => ({
  id: `sk-bd-${turnRef}-${signalType}`,
  subject_id: "ryo",
  type: "boundary_event",
  source: "motor_inferred",
  confidence: 0.85,
  confirmed_at: null,
  alignment: "unknown",
  payload: {
    kind: "boundary_event",
    signal_type: signalType,
    topic_category: topicCategory,
    intensity,
    motor_response: "muda_tema",
    severity_band: "routine",
  },
  turn_ref: turnRef,
  session_id: sessionId,
  created_at: "2026-05-25T10:00:00.000Z",
});

describe("scanner indexa subjectKnowledgeEvents do trace", () => {
  it("lê eventos no nível do turn", async () => {
    writeTrace("s1", {
      sessionId: "ryo__sess-1",
      persona: "ryo",
      startedAt: "2026-05-25T10:00:00.000Z",
      turns: [
        {
          turnNumber: 1,
          incomingMessage: "eu gosto de tênis",
          finalResponse: "legal",
          subjectKnowledgeEvents: [
            fakeInterestEvent("ryo__sess-1", "ryo__sess-1__turn_1", "tênis"),
          ],
        },
      ],
    });

    const result = await scanTraces({ tracesDir: tmpRoot, db });
    expect(result.sessionsIndexed).toBe(1);

    const discoveries = listSubjectDiscoveries(db, "ryo");
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0].type).toBe("interest");
    if (discoveries[0].payload.kind === "interest") {
      expect(discoveries[0].payload.label).toBe("tênis");
    }
  });

  it("lê eventos do fallback motorTrace.drota.subjectKnowledgeEvents", async () => {
    writeTrace("s2", {
      sessionId: "ryo__sess-2",
      persona: "ryo",
      startedAt: "2026-05-25T10:00:00.000Z",
      turns: [
        {
          turnNumber: 1,
          incomingMessage: "x",
          finalResponse: "y",
          motorTrace: {
            drota: {
              subjectKnowledgeEvents: [
                fakeInterestEvent("ryo__sess-2", "ryo__sess-2__turn_1", "anime"),
              ],
            },
          },
        },
      ],
    });
    await scanTraces({ tracesDir: tmpRoot, db });
    const discoveries = listSubjectDiscoveries(db, "ryo");
    expect(discoveries).toHaveLength(1);
  });

  it("re-scan substitui events (idempotência)", async () => {
    writeTrace("s3", {
      sessionId: "ryo__sess-3",
      persona: "ryo",
      startedAt: "2026-05-25T10:00:00.000Z",
      turns: [
        {
          turnNumber: 1,
          incomingMessage: "x",
          finalResponse: "y",
          subjectKnowledgeEvents: [
            fakeInterestEvent("ryo__sess-3", "ryo__sess-3__turn_1", "skate"),
          ],
        },
      ],
    });
    await scanTraces({ tracesDir: tmpRoot, db });
    await scanTraces({ tracesDir: tmpRoot, db });
    const discoveries = listSubjectDiscoveries(db, "ryo");
    expect(discoveries).toHaveLength(1);
  });

  it("ignora linhas inválidas sem derrubar scan", async () => {
    writeTrace("s4", {
      sessionId: "ryo__sess-4",
      persona: "ryo",
      startedAt: "2026-05-25T10:00:00.000Z",
      turns: [
        {
          turnNumber: 1,
          incomingMessage: "x",
          finalResponse: "y",
          subjectKnowledgeEvents: [
            { type: "fake_type", subject_id: "ryo" }, // inválido — falta id, CHECK falha
            fakeInterestEvent("ryo__sess-4", "ryo__sess-4__turn_1", "ok"),
          ],
        },
      ],
    });
    const result = await scanTraces({ tracesDir: tmpRoot, db });
    expect(result.errors).toHaveLength(0);
    const discoveries = listSubjectDiscoveries(db, "ryo");
    expect(discoveries).toHaveLength(1); // só o válido
  });
});

describe("BFF endpoints /subjects/:id/...", () => {
  beforeEach(() => {
    // popula direto
    writeTrace("ep", {
      sessionId: "ryo__sess-ep",
      persona: "ryo",
      startedAt: "2026-05-25T10:00:00.000Z",
      turns: [
        {
          turnNumber: 1,
          incomingMessage: "eu gosto de tênis e anime",
          finalResponse: "ok",
          subjectKnowledgeEvents: [
            fakeInterestEvent("ryo__sess-ep", "ryo__sess-ep__turn_1", "tênis"),
            fakeInterestEvent("ryo__sess-ep", "ryo__sess-ep__turn_1", "anime"),
          ],
        },
        {
          turnNumber: 3,
          incomingMessage: "não quero falar disso",
          finalResponse: "ok",
          subjectKnowledgeEvents: [
            fakeBoundaryEvent(
              "ryo__sess-ep",
              "ryo__sess-ep__turn_3",
              "deflection_thematic",
              "tema_escolar",
            ),
          ],
        },
        {
          turnNumber: 5,
          incomingMessage: "não",
          finalResponse: "ok",
          subjectKnowledgeEvents: [
            fakeBoundaryEvent(
              "ryo__sess-ep",
              "ryo__sess-ep__turn_5",
              "deflection_thematic",
              "tema_escolar",
              "high",
            ),
          ],
        },
      ],
    });
    return scanTraces({ tracesDir: tmpRoot, db });
  });

  const inject = async (url: string) => {
    const res = await server.fastify.inject({ method: "GET", url });
    return {
      status: res.statusCode,
      body: JSON.parse(res.body) as Record<string, unknown>,
    };
  };

  it("GET /subjects/ryo/discoveries retorna interests", async () => {
    const res = await inject("/subjects/ryo/discoveries");
    expect(res.status).toBe(200);
    const list = res.body.discoveries as Array<{ type: string }>;
    expect(list.length).toBe(2);
    expect(list.every((d) => d.type === "interest")).toBe(true);
  });

  it("GET /subjects/ryo/discoveries?type=interest filtra", async () => {
    const res = await inject("/subjects/ryo/discoveries?type=interest");
    expect(res.status).toBe(200);
    const list = res.body.discoveries as Array<unknown>;
    expect(list.length).toBe(2);
  });

  it("GET /subjects/ryo/boundaries retorna boundary_events", async () => {
    const res = await inject("/subjects/ryo/boundaries");
    expect(res.status).toBe(200);
    const list = res.body.boundaries as Array<{ type: string }>;
    expect(list.length).toBe(2);
    expect(list.every((b) => b.type === "boundary_event")).toBe(true);
  });

  it("GET /subjects/ryo/boundaries/summary agrega por topic_category", async () => {
    const res = await inject("/subjects/ryo/boundaries/summary");
    expect(res.status).toBe(200);
    const list = res.body.summary as Array<{
      topic_category: string;
      count: number;
      high_intensity_count: number;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0].topic_category).toBe("tema_escolar");
    expect(list[0].count).toBe(2);
    expect(list[0].high_intensity_count).toBe(1);
  });

  it("listSubjectDiscoveries filtra por sessionId", () => {
    const list = listSubjectDiscoveries(db, "ryo", {
      sessionId: "ryo__sess-ep",
    });
    expect(list.length).toBe(2);
    const empty = listSubjectDiscoveries(db, "ryo", {
      sessionId: "ryo__nada",
    });
    expect(empty).toHaveLength(0);
  });

  it("summarizeBoundariesByCategory retorna array vazio se zero events", () => {
    const summary = summarizeBoundariesByCategory(db, "kei");
    expect(summary).toEqual([]);
  });
});
