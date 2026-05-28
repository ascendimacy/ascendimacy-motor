/**
 * S4 routes unit tests — expression metrics + tactic distribution + samples.
 *
 * Setup: cria trace files temporários em disco com engineTrace v2 sintético,
 * indexa via scanTraces, e exercita endpoints através do BFF Fastify.
 *
 * Cobertura:
 *  - happy paths (metrics, distribution split=on/off, samples)
 *  - empty (persona sem traces → developmentStub: true)
 *  - calculations corretos (cache hit rate, fallback rate, byModel breakdown)
 *  - tactic distribution split active vs inactive
 *  - samples ordenadas DESC + limit + flags
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "../src/db.js";
import { createBffServer, type BffServer } from "../src/server.js";
import { createMockDaemonClient } from "../src/daemon-client.js";
import { scanTraces } from "../src/traces-scanner.js";
import type { Database as DatabaseType } from "better-sqlite3";

let tmpRoot: string;
let server: BffServer;
let db: DatabaseType;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "s4-routes-test-"));
  db = initDb({ dbPath: ":memory:" });
  const daemon = createMockDaemonClient();
  server = createBffServer({
    daemon,
    db,
    logger: false,
    tracesDir: tmpRoot,
  });
});

afterEach(async () => {
  await server.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

const inject = async (url: string) => {
  const res = await server.fastify.inject({ method: "GET", url });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null,
  };
};

interface CallSpec {
  id: string;
  role: string;
  model: string;
  duration_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_cache_hit?: boolean;
}

interface TurnSpec {
  turnNumber: number;
  timestamp?: string;
  finalResponse: string;
  llmCalls?: CallSpec[];
  speakerRetried?: boolean;
  sanitized?: boolean;
  speakerCallRef?: string;
  materializerCallRef?: string;
  tacticDecision?: {
    jogada: string;
    angle?: string;
    register?: string;
    max_length_chars?: number;
  };
  tacticianMethod?: "rule" | "llm" | "fallback";
}

function writeTrace(
  sessionId: string,
  personaId: string,
  startedAt: string,
  turns: TurnSpec[],
): string {
  const sessionDir = join(tmpRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const tracePath = join(sessionDir, "trace.json");

  const builtTurns = turns.map((t) => {
    const speakerRef = t.speakerCallRef;
    const matRef = t.materializerCallRef;
    const turn: Record<string, unknown> = {
      turnNumber: t.turnNumber,
      sessionId,
      timestamp: t.timestamp ?? startedAt,
      finalResponse: t.finalResponse,
    };
    if (
      t.llmCalls !== undefined ||
      t.speakerRetried !== undefined ||
      t.sanitized !== undefined ||
      t.tacticDecision !== undefined
    ) {
      const components: Record<string, unknown> = {};
      if (speakerRef !== undefined || t.speakerRetried !== undefined) {
        components["speaker"] = {
          inputs: { jogada: t.tacticDecision?.jogada ?? "bridge" },
          outputs: { raw_response: t.finalResponse, final_text: t.finalResponse },
          retried_with_fallback: t.speakerRetried === true,
          llm_call_ref: speakerRef ?? `${sessionId}-spk-${t.turnNumber}`,
        };
      }
      if (matRef !== undefined) {
        components["constrained_materializer"] = {
          outputs: { raw_response: t.finalResponse, final_text: t.finalResponse },
          llm_call_ref: matRef,
        };
      }
      if (t.tacticianMethod !== undefined) {
        components["tactician"] = {
          method: t.tacticianMethod,
          duration_ms: 50,
        };
      }
      const et: Record<string, unknown> = {
        schema_version: 2,
        components,
        llm_calls: t.llmCalls ?? [],
      };
      if (t.tacticDecision !== undefined) {
        et["tactic_decision"] = {
          jogada: t.tacticDecision.jogada,
          angle: t.tacticDecision.angle ?? "vamos lá",
          constraints: {
            register: t.tacticDecision.register ?? "neutro",
            max_length_chars: t.tacticDecision.max_length_chars ?? 280,
          },
        };
      }
      if (t.sanitized !== undefined) {
        et["sanitization_applied"] = t.sanitized;
      }
      turn["engineTrace"] = et;
    }
    return turn;
  });

  const trace = {
    sessionId,
    persona: personaId,
    startedAt,
    endedAt: startedAt,
    turns: builtTurns,
  };
  writeFileSync(tracePath, JSON.stringify(trace, null, 2), "utf-8");
  return tracePath;
}

async function reindex(): Promise<void> {
  await scanTraces({ tracesDir: tmpRoot, db });
}

describe("GET /personas/:id/expression-metrics", () => {
  it("retorna developmentStub=true para persona sem nenhum trace", async () => {
    await reindex();
    const res = await inject("/personas/never-seen/expression-metrics");
    expect(res.status).toBe(200);
    const body = res.body as {
      personaId: string;
      totalTurns: number;
      developmentStub: boolean;
    };
    expect(body.personaId).toBe("never-seen");
    expect(body.totalTurns).toBe(0);
    expect(body.developmentStub).toBe(true);
  });

  it("retorna developmentStub=true para persona com traces v1 (sem engineTrace)", async () => {
    writeTrace("ryo__v1-1", "ryo", "2026-05-27T10:00:00.000Z", [
      { turnNumber: 1, finalResponse: "Oi!" },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-metrics");
    expect(res.status).toBe(200);
    const body = res.body as { totalTurns: number; developmentStub: boolean };
    expect(body.totalTurns).toBe(1);
    expect(body.developmentStub).toBe(true);
  });

  it("calcula cacheHitRate corretamente (2 hits em 4 calls = 0.5)", async () => {
    writeTrace("ryo__cache-1", "ryo", "2026-05-27T10:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "Resposta A",
        llmCalls: [
          {
            id: "c1",
            role: "speaker",
            model: "claude-haiku-4-5",
            duration_ms: 1500,
            prompt_cache_hit: true,
          },
          {
            id: "c2",
            role: "speaker",
            model: "claude-haiku-4-5",
            duration_ms: 1700,
            prompt_cache_hit: false,
          },
        ],
        speakerCallRef: "c1",
      },
      {
        turnNumber: 2,
        finalResponse: "Resposta B",
        llmCalls: [
          {
            id: "c3",
            role: "speaker",
            model: "claude-haiku-4-5",
            duration_ms: 1400,
            prompt_cache_hit: true,
          },
          {
            id: "c4",
            role: "speaker",
            model: "claude-haiku-4-5",
            duration_ms: 1600,
            prompt_cache_hit: false,
          },
        ],
        speakerCallRef: "c3",
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-metrics");
    const body = res.body as { cacheHitRate: number; totalTurns: number };
    expect(body.totalTurns).toBe(2);
    expect(body.cacheHitRate).toBeCloseTo(0.5, 3);
  });

  it("calcula fallbackRate baseado em speaker.retried_with_fallback", async () => {
    writeTrace("ryo__fb-1", "ryo", "2026-05-27T11:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "A",
        speakerCallRef: "c1",
        llmCalls: [
          { id: "c1", role: "speaker", model: "claude-haiku-4-5", duration_ms: 100 },
        ],
        speakerRetried: true,
      },
      {
        turnNumber: 2,
        finalResponse: "B",
        speakerCallRef: "c2",
        llmCalls: [
          { id: "c2", role: "speaker", model: "claude-haiku-4-5", duration_ms: 100 },
        ],
        speakerRetried: false,
      },
      {
        turnNumber: 3,
        finalResponse: "C",
        speakerCallRef: "c3",
        llmCalls: [
          { id: "c3", role: "speaker", model: "claude-haiku-4-5", duration_ms: 100 },
        ],
        speakerRetried: false,
      },
      {
        turnNumber: 4,
        finalResponse: "D",
        speakerCallRef: "c4",
        llmCalls: [
          { id: "c4", role: "speaker", model: "claude-haiku-4-5", duration_ms: 100 },
        ],
        speakerRetried: false,
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-metrics");
    const body = res.body as {
      fallbackRate: number;
      retriedWithFallbackRate: number;
    };
    expect(body.fallbackRate).toBeCloseTo(0.25, 3);
    expect(body.retriedWithFallbackRate).toBeCloseTo(0.25, 3);
  });

  it("calcula avgTokensIn/Out + avgLatencyMs corretos", async () => {
    writeTrace("ryo__tok-1", "ryo", "2026-05-27T12:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "X",
        speakerCallRef: "c1",
        llmCalls: [
          {
            id: "c1",
            role: "speaker",
            model: "claude-haiku-4-5",
            input_tokens: 1000,
            output_tokens: 100,
            duration_ms: 2000,
          },
        ],
      },
      {
        turnNumber: 2,
        finalResponse: "Y",
        speakerCallRef: "c2",
        llmCalls: [
          {
            id: "c2",
            role: "speaker",
            model: "claude-haiku-4-5",
            input_tokens: 2000,
            output_tokens: 200,
            duration_ms: 3000,
          },
        ],
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-metrics");
    const body = res.body as {
      avgTokensIn: number;
      avgTokensOut: number;
      avgLatencyMs: number;
    };
    expect(body.avgTokensIn).toBeCloseTo(1500, 3);
    expect(body.avgTokensOut).toBeCloseTo(150, 3);
    expect(body.avgLatencyMs).toBeCloseTo(2500, 3);
  });

  it("byModel breakdown agrega calls + avgLatency por modelo", async () => {
    writeTrace("ryo__model-1", "ryo", "2026-05-27T13:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "A",
        speakerCallRef: "c1",
        llmCalls: [
          { id: "c1", role: "speaker", model: "claude-haiku-4-5", duration_ms: 1500 },
        ],
      },
      {
        turnNumber: 2,
        finalResponse: "B",
        speakerCallRef: "c2",
        llmCalls: [
          { id: "c2", role: "speaker", model: "local:qwen3-30b", duration_ms: 2400 },
        ],
      },
      {
        turnNumber: 3,
        finalResponse: "C",
        speakerCallRef: "c3",
        llmCalls: [
          { id: "c3", role: "speaker", model: "claude-haiku-4-5", duration_ms: 1700 },
        ],
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-metrics");
    const body = res.body as {
      byModel: Record<string, { calls: number; avgLatencyMs: number }>;
    };
    expect(body.byModel["claude-haiku-4-5"]).toBeDefined();
    expect(body.byModel["claude-haiku-4-5"]!.calls).toBe(2);
    expect(body.byModel["claude-haiku-4-5"]!.avgLatencyMs).toBeCloseTo(1600, 3);
    expect(body.byModel["local:qwen3-30b"]).toBeDefined();
    expect(body.byModel["local:qwen3-30b"]!.calls).toBe(1);
  });

  it("ignora chamadas com role != materializer/speaker (planner, assessor)", async () => {
    writeTrace("ryo__role-1", "ryo", "2026-05-27T14:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "X",
        speakerCallRef: "c-spk",
        llmCalls: [
          { id: "c-spk", role: "speaker", model: "claude-haiku-4-5", duration_ms: 1500 },
          { id: "c-asses", role: "unified_assessor", model: "claude-haiku-4-5", duration_ms: 800 },
          { id: "c-plan", role: "planejador", model: "claude-opus-4-7", duration_ms: 5000 },
        ],
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-metrics");
    const body = res.body as {
      byModel: Record<string, { calls: number }>;
      avgLatencyMs: number;
    };
    // Apenas a chamada speaker conta.
    expect(body.byModel["claude-haiku-4-5"]!.calls).toBe(1);
    expect(body.byModel["claude-opus-4-7"]).toBeUndefined();
    expect(body.avgLatencyMs).toBeCloseTo(1500, 3);
  });
});

describe("GET /personas/:id/tactic-decision-distribution", () => {
  it("retorna developmentStub=true + splitDrotaActive=false sem tactic_decision", async () => {
    writeTrace("ryo__no-td-1", "ryo", "2026-05-27T15:00:00.000Z", [
      { turnNumber: 1, finalResponse: "A" },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/tactic-decision-distribution");
    expect(res.status).toBe(200);
    const body = res.body as {
      splitDrotaActive: boolean;
      developmentStub: boolean;
      totalDecisions: number;
    };
    expect(body.splitDrotaActive).toBe(false);
    expect(body.developmentStub).toBe(true);
    expect(body.totalDecisions).toBe(0);
  });

  it("retorna distribuição por jogada + register + method quando split ativo", async () => {
    writeTrace("ryo__td-1", "ryo", "2026-05-27T16:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "A",
        tacticDecision: { jogada: "bridge", register: "lúdico" },
        tacticianMethod: "rule",
      },
      {
        turnNumber: 2,
        finalResponse: "B",
        tacticDecision: { jogada: "espelho", register: "acolhedor" },
        tacticianMethod: "llm",
      },
      {
        turnNumber: 3,
        finalResponse: "C",
        tacticDecision: { jogada: "bridge", register: "lúdico" },
        tacticianMethod: "rule",
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/tactic-decision-distribution");
    const body = res.body as {
      splitDrotaActive: boolean;
      developmentStub: boolean;
      totalDecisions: number;
      byJogada: Record<string, number>;
      byRegister: Record<string, number>;
      byMethod: Record<string, number>;
    };
    expect(body.splitDrotaActive).toBe(true);
    expect(body.developmentStub).toBe(false);
    expect(body.totalDecisions).toBe(3);
    expect(body.byJogada).toEqual({ bridge: 2, espelho: 1 });
    expect(body.byRegister).toEqual({ "lúdico": 2, acolhedor: 1 });
    expect(body.byMethod).toEqual({ rule: 2, llm: 1 });
  });

  it("calcula averages de angle e max_length_chars", async () => {
    writeTrace("ryo__avg-1", "ryo", "2026-05-27T17:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "A",
        tacticDecision: { jogada: "bridge", angle: "abcdefghij", max_length_chars: 200 },
      },
      {
        turnNumber: 2,
        finalResponse: "B",
        tacticDecision: { jogada: "bridge", angle: "abcdefghijklmnopqrst", max_length_chars: 300 },
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/tactic-decision-distribution");
    const body = res.body as {
      averages: { angleCharsAvg: number; maxLengthCharsAvg: number };
    };
    expect(body.averages.angleCharsAvg).toBeCloseTo(15, 3);
    expect(body.averages.maxLengthCharsAvg).toBeCloseTo(250, 3);
  });
});

describe("GET /personas/:id/expression-samples", () => {
  it("retorna developmentStub=true + samples=[] para persona sem traces", async () => {
    await reindex();
    const res = await inject("/personas/ghost/expression-samples");
    expect(res.status).toBe(200);
    const body = res.body as {
      samples: unknown[];
      developmentStub: boolean;
    };
    expect(body.samples).toEqual([]);
    expect(body.developmentStub).toBe(true);
  });

  it("retorna samples em ordem DESC (mais recentes primeiro) + respeita limit", async () => {
    writeTrace("ryo__samp-1", "ryo", "2026-05-27T18:00:00.000Z", [
      { turnNumber: 1, timestamp: "2026-05-27T18:00:00Z", finalResponse: "T1" },
      { turnNumber: 2, timestamp: "2026-05-27T18:01:00Z", finalResponse: "T2" },
      { turnNumber: 3, timestamp: "2026-05-27T18:02:00Z", finalResponse: "T3" },
      { turnNumber: 4, timestamp: "2026-05-27T18:03:00Z", finalResponse: "T4" },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-samples?limit=2");
    const body = res.body as {
      samples: Array<{ turnRef: string; finalText: string }>;
    };
    expect(body.samples.length).toBe(2);
    expect(body.samples[0]!.finalText).toBe("T4");
    expect(body.samples[1]!.finalText).toBe("T3");
  });

  it("inclui flags fallback + sanitize + jogada + model quando engineTrace presente", async () => {
    writeTrace("ryo__rich-1", "ryo", "2026-05-27T19:00:00.000Z", [
      {
        turnNumber: 1,
        finalResponse: "Resposta rica",
        speakerCallRef: "call-1",
        llmCalls: [
          {
            id: "call-1",
            role: "speaker",
            model: "claude-haiku-4-5",
            duration_ms: 1234,
            output_tokens: 22,
          },
        ],
        speakerRetried: true,
        sanitized: true,
        tacticDecision: { jogada: "espelho" },
      },
    ]);
    await reindex();
    const res = await inject("/personas/ryo/expression-samples");
    const body = res.body as {
      samples: Array<{
        finalText: string;
        model: string | null;
        latencyMs: number | null;
        tokensOut: number | null;
        fallbackTriggered: boolean;
        sanitizationApplied: boolean;
        jogada: string | null;
        turnRef: string;
      }>;
    };
    expect(body.samples.length).toBe(1);
    const s = body.samples[0]!;
    expect(s.finalText).toBe("Resposta rica");
    expect(s.model).toBe("claude-haiku-4-5");
    expect(s.latencyMs).toBe(1234);
    expect(s.tokensOut).toBe(22);
    expect(s.fallbackTriggered).toBe(true);
    expect(s.sanitizationApplied).toBe(true);
    expect(s.jogada).toBe("espelho");
    expect(s.turnRef).toBe("ryo__rich-1__turn_1");
  });
});
