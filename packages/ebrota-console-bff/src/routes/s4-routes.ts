/**
 * S4 wiring — Motor de Expressão (aggregate metrics + tactic distribution +
 * recent samples).
 *
 * Spec parent: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 *
 * Endpoints expostos:
 *   GET  /personas/:id/expression-metrics
 *   GET  /personas/:id/tactic-decision-distribution
 *   GET  /personas/:id/expression-samples?limit=N
 *
 * Fonte: lê engine-trace-v2.json files de `tracesDir` (sessions index
 * em SQLite aponta pra paths). Cada turn pode carregar `engineTrace`
 * v2 (TV2 sub-fase) com seções:
 *   - components.constrained_materializer
 *   - components.speaker
 *   - components.tactician
 *   - llm_calls (catálogo flat cross-component)
 *   - tactic_decision (S4 split — USE_SPLIT_DROTA=true)
 *
 * Quando `engineTrace` ausente em todos os turns (traces v1 antigos),
 * endpoints retornam `developmentStub: true` com totals=0. Permite UI
 * mostrar empty state coerente sem 404.
 */

import { readFile } from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";

export interface S4RoutesOptions {
  db: DatabaseType;
  /** Diretório raiz de traces. Quando omitido, endpoints retornam
   *  developmentStub: true sem tentar ler disco. */
  tracesDir?: string;
}

interface SessionRow {
  session_id: string;
  trace_path: string | null;
  started_at: string;
}

interface RawLlmCall {
  id?: string;
  role?: string;
  provider?: string;
  model?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_cache_hit?: boolean;
}

interface RawMaterializer {
  outputs?: { raw_response?: string; final_text?: string };
  llm_call_ref?: string;
  duration_ms?: number;
}

interface RawSpeaker {
  outputs?: { raw_response?: string; final_text?: string };
  retried_with_fallback?: boolean;
  llm_call_ref?: string;
  duration_ms?: number;
  inputs?: { jogada?: string };
}

interface RawTactician {
  outputs?: { jogada?: string; angle?: string; rationale?: string };
  method?: "rule" | "llm" | "fallback";
  duration_ms?: number;
}

interface RawTacticDecision {
  jogada?: string;
  angle?: string;
  rationale?: string;
  constraints?: {
    register?: string;
    max_length_chars?: number;
  };
}

interface RawEngineTrace {
  schema_version?: number;
  components?: {
    constrained_materializer?: RawMaterializer;
    speaker?: RawSpeaker;
    tactician?: RawTactician;
  };
  llm_calls?: RawLlmCall[];
  tactic_decision?: RawTacticDecision;
  /** Future-ready: emitido por guardrail quando aplica sanitize. */
  sanitization_applied?: boolean;
}

interface RawTurn {
  turnNumber?: number;
  turn?: number;
  sessionId?: string;
  timestamp?: string;
  finalResponse?: string;
  botMessage?: string;
  engineTrace?: RawEngineTrace;
}

interface RawTrace {
  sessionId?: string;
  persona?: string;
  personaId?: string;
  startedAt?: string;
  turns?: RawTurn[];
}

export interface ExpressionMetrics {
  personaId: string;
  totalTurns: number;
  cacheHitRate: number;
  fallbackRate: number;
  avgTokensIn: number;
  avgTokensOut: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  sanitizationAppliedRate: number;
  retriedWithFallbackRate: number;
  byModel: Record<string, { calls: number; avgLatencyMs: number }>;
  developmentStub: boolean;
}

export interface TacticDecisionDistribution {
  personaId: string;
  totalDecisions: number;
  splitDrotaActive: boolean;
  byJogada: Record<string, number>;
  byRegister: Record<string, number>;
  byMethod: Record<string, number>;
  averages: {
    angleCharsAvg: number;
    maxLengthCharsAvg: number;
  };
  developmentStub: boolean;
}

export interface ExpressionSample {
  turnRef: string;
  generatedAt: string | null;
  finalText: string;
  model: string | null;
  latencyMs: number | null;
  tokensOut: number | null;
  fallbackTriggered: boolean;
  sanitizationApplied: boolean;
  jogada: string | null;
}

export interface ExpressionSamplesResponse {
  personaId: string;
  samples: ExpressionSample[];
  developmentStub: boolean;
}

// Pricing per 1M tokens em USD — usado pra estimar avgCostUsd quando
// o trace traz tokens mas não cost. Conservador; modelos desconhecidos
// caem em 0. Valores documentados pra refresh manual quando provider
// publica nova grade.
const PRICING_PER_1M_USD: Record<
  string,
  { input: number; output: number }
> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "qwen3-30b": { input: 0.0, output: 0.0 },
};

function pricingFor(model: string): { input: number; output: number } {
  // Heuristic: provider-prefixed model ("anthropic:claude-haiku-4-5") → strip prefix.
  const idx = model.indexOf(":");
  const key = idx === -1 ? model : model.slice(idx + 1);
  return PRICING_PER_1M_USD[key] ?? { input: 0, output: 0 };
}

function listSessionsForPersona(
  db: DatabaseType,
  personaId: string,
): SessionRow[] {
  return db
    .prepare(
      `SELECT session_id, trace_path, started_at
       FROM sessions
       WHERE persona_id = ? AND trace_path IS NOT NULL
       ORDER BY started_at DESC`,
    )
    .all(personaId) as SessionRow[];
}

async function readTrace(tracePath: string): Promise<RawTrace | null> {
  try {
    const raw = await readFile(tracePath, "utf-8");
    return JSON.parse(raw) as RawTrace;
  } catch {
    return null;
  }
}

interface AggregateAccumulator {
  totalTurns: number;
  turnsWithEngineTrace: number;
  cacheHits: number;
  fallbacks: number;
  retriedFallbacks: number;
  sanitized: number;
  tokensIn: number;
  tokensOut: number;
  latencyMsSum: number;
  costUsdSum: number;
  byModel: Map<string, { calls: number; latencyMsSum: number }>;
}

function emptyAccumulator(): AggregateAccumulator {
  return {
    totalTurns: 0,
    turnsWithEngineTrace: 0,
    cacheHits: 0,
    fallbacks: 0,
    retriedFallbacks: 0,
    sanitized: 0,
    tokensIn: 0,
    tokensOut: 0,
    latencyMsSum: 0,
    costUsdSum: 0,
    byModel: new Map(),
  };
}

function accumulateTurn(
  acc: AggregateAccumulator,
  turn: RawTurn,
): void {
  const et = turn.engineTrace;
  if (et === undefined) return;
  acc.turnsWithEngineTrace += 1;

  const calls = et.llm_calls ?? [];
  // S4 only — restringe a llm_calls cuja role é materializer/speaker.
  // Outras roles (assessor, planner, tactician) entram em outros panels.
  const expressionCalls = calls.filter(
    (c) =>
      c.role === "constrained_materializer" ||
      c.role === "speaker" ||
      c.role === "materializer",
  );

  for (const call of expressionCalls) {
    if (call.prompt_cache_hit === true) acc.cacheHits += 1;
    acc.tokensIn += call.input_tokens ?? 0;
    acc.tokensOut += call.output_tokens ?? 0;
    acc.latencyMsSum += call.duration_ms ?? 0;
    if (typeof call.model === "string" && call.model.length > 0) {
      const pricing = pricingFor(call.model);
      const cost =
        ((call.input_tokens ?? 0) * pricing.input +
          (call.output_tokens ?? 0) * pricing.output) /
        1_000_000;
      acc.costUsdSum += cost;
      const existing = acc.byModel.get(call.model) ?? {
        calls: 0,
        latencyMsSum: 0,
      };
      existing.calls += 1;
      existing.latencyMsSum += call.duration_ms ?? 0;
      acc.byModel.set(call.model, existing);
    }
  }

  const speaker = et.components?.speaker;
  if (speaker?.retried_with_fallback === true) {
    acc.retriedFallbacks += 1;
    acc.fallbacks += 1;
  }
  if (et.sanitization_applied === true) acc.sanitized += 1;
}

function buildMetrics(
  personaId: string,
  acc: AggregateAccumulator,
): ExpressionMetrics {
  const totalTurns = acc.totalTurns;
  const expressionCallCount = Array.from(acc.byModel.values()).reduce(
    (sum, m) => sum + m.calls,
    0,
  );
  const expressionDenom = expressionCallCount === 0 ? 1 : expressionCallCount;
  const turnsDenom = totalTurns === 0 ? 1 : totalTurns;

  const byModel: Record<string, { calls: number; avgLatencyMs: number }> = {};
  for (const [model, data] of acc.byModel) {
    byModel[model] = {
      calls: data.calls,
      avgLatencyMs: data.calls > 0 ? data.latencyMsSum / data.calls : 0,
    };
  }

  return {
    personaId,
    totalTurns,
    cacheHitRate:
      expressionCallCount > 0 ? acc.cacheHits / expressionDenom : 0,
    fallbackRate: totalTurns > 0 ? acc.fallbacks / turnsDenom : 0,
    avgTokensIn:
      expressionCallCount > 0 ? acc.tokensIn / expressionDenom : 0,
    avgTokensOut:
      expressionCallCount > 0 ? acc.tokensOut / expressionDenom : 0,
    avgLatencyMs:
      expressionCallCount > 0 ? acc.latencyMsSum / expressionDenom : 0,
    avgCostUsd:
      expressionCallCount > 0 ? acc.costUsdSum / expressionDenom : 0,
    sanitizationAppliedRate:
      totalTurns > 0 ? acc.sanitized / turnsDenom : 0,
    retriedWithFallbackRate:
      totalTurns > 0 ? acc.retriedFallbacks / turnsDenom : 0,
    byModel,
    developmentStub: acc.turnsWithEngineTrace === 0,
  };
}

interface TacticAccumulator {
  totalDecisions: number;
  splitDrotaActive: boolean;
  byJogada: Map<string, number>;
  byRegister: Map<string, number>;
  byMethod: Map<string, number>;
  angleCharsSum: number;
  angleCharsCount: number;
  maxLengthSum: number;
  maxLengthCount: number;
}

function emptyTacticAcc(): TacticAccumulator {
  return {
    totalDecisions: 0,
    splitDrotaActive: false,
    byJogada: new Map(),
    byRegister: new Map(),
    byMethod: new Map(),
    angleCharsSum: 0,
    angleCharsCount: 0,
    maxLengthSum: 0,
    maxLengthCount: 0,
  };
}

function inc(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function accumulateTactic(acc: TacticAccumulator, turn: RawTurn): void {
  const et = turn.engineTrace;
  if (et === undefined) return;
  const td = et.tactic_decision;
  if (td === undefined) return;

  acc.totalDecisions += 1;
  acc.splitDrotaActive = true;

  if (typeof td.jogada === "string" && td.jogada.length > 0) {
    inc(acc.byJogada, td.jogada);
  }
  const reg = td.constraints?.register;
  if (typeof reg === "string" && reg.length > 0) {
    inc(acc.byRegister, reg);
  }
  const method = et.components?.tactician?.method;
  if (typeof method === "string") {
    inc(acc.byMethod, method);
  }
  if (typeof td.angle === "string") {
    acc.angleCharsSum += td.angle.length;
    acc.angleCharsCount += 1;
  }
  const ml = td.constraints?.max_length_chars;
  if (typeof ml === "number" && Number.isFinite(ml)) {
    acc.maxLengthSum += ml;
    acc.maxLengthCount += 1;
  }
}

function buildDistribution(
  personaId: string,
  acc: TacticAccumulator,
): TacticDecisionDistribution {
  const toObj = (m: Map<string, number>): Record<string, number> => {
    const obj: Record<string, number> = {};
    for (const [k, v] of m) obj[k] = v;
    return obj;
  };

  return {
    personaId,
    totalDecisions: acc.totalDecisions,
    splitDrotaActive: acc.splitDrotaActive,
    byJogada: toObj(acc.byJogada),
    byRegister: toObj(acc.byRegister),
    byMethod: toObj(acc.byMethod),
    averages: {
      angleCharsAvg:
        acc.angleCharsCount > 0
          ? acc.angleCharsSum / acc.angleCharsCount
          : 0,
      maxLengthCharsAvg:
        acc.maxLengthCount > 0
          ? acc.maxLengthSum / acc.maxLengthCount
          : 0,
    },
    developmentStub: !acc.splitDrotaActive,
  };
}

function turnRef(sessionId: string, turn: RawTurn): string {
  const n = turn.turnNumber ?? turn.turn ?? 0;
  return `${sessionId}__turn_${n}`;
}

function findCallByRef(
  calls: RawLlmCall[],
  ref: string | undefined,
): RawLlmCall | undefined {
  if (ref === undefined) return undefined;
  return calls.find((c) => c.id === ref);
}

function buildSample(
  sessionId: string,
  turn: RawTurn,
  generatedAt: string | null,
): ExpressionSample | null {
  const finalText = turn.finalResponse ?? turn.botMessage ?? "";
  if (finalText.length === 0) return null;

  const et = turn.engineTrace;
  const speaker = et?.components?.speaker;
  const materializer = et?.components?.constrained_materializer;
  const calls = et?.llm_calls ?? [];

  // Prefer Speaker call (S4 split active); fallback to materializer call.
  const ref = speaker?.llm_call_ref ?? materializer?.llm_call_ref;
  const call = findCallByRef(calls, ref);

  return {
    turnRef: turnRef(sessionId, turn),
    generatedAt: turn.timestamp ?? generatedAt,
    finalText,
    model: call?.model ?? null,
    latencyMs: call?.duration_ms ?? speaker?.duration_ms ?? materializer?.duration_ms ?? null,
    tokensOut: call?.output_tokens ?? null,
    fallbackTriggered: speaker?.retried_with_fallback === true,
    sanitizationApplied: et?.sanitization_applied === true,
    jogada:
      et?.tactic_decision?.jogada ??
      speaker?.inputs?.jogada ??
      null,
  };
}

const s4Routes: FastifyPluginAsync<S4RoutesOptions> = async (fastify, opts) => {
  const { db, tracesDir } = opts;

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/expression-metrics",
    async (req) => {
      const personaId = req.params.id;
      if (tracesDir === undefined) {
        return buildMetrics(personaId, emptyAccumulator());
      }
      const sessions = listSessionsForPersona(db, personaId);
      const acc = emptyAccumulator();
      for (const sess of sessions) {
        if (sess.trace_path === null) continue;
        const trace = await readTrace(sess.trace_path);
        if (trace === null) continue;
        const turns = trace.turns ?? [];
        for (const t of turns) {
          acc.totalTurns += 1;
          accumulateTurn(acc, t);
        }
      }
      return buildMetrics(personaId, acc);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/tactic-decision-distribution",
    async (req) => {
      const personaId = req.params.id;
      if (tracesDir === undefined) {
        return buildDistribution(personaId, emptyTacticAcc());
      }
      const sessions = listSessionsForPersona(db, personaId);
      const acc = emptyTacticAcc();
      for (const sess of sessions) {
        if (sess.trace_path === null) continue;
        const trace = await readTrace(sess.trace_path);
        if (trace === null) continue;
        for (const t of trace.turns ?? []) {
          accumulateTactic(acc, t);
        }
      }
      return buildDistribution(personaId, acc);
    },
  );

  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/personas/:id/expression-samples", async (req) => {
    const personaId = req.params.id;
    const rawLimit = req.query.limit;
    let limit = 10;
    if (rawLimit !== undefined) {
      const n = Number.parseInt(rawLimit, 10);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, 200);
    }
    if (tracesDir === undefined) {
      const empty: ExpressionSamplesResponse = {
        personaId,
        samples: [],
        developmentStub: true,
      };
      return empty;
    }
    const sessions = listSessionsForPersona(db, personaId);
    const samples: ExpressionSample[] = [];
    let sawEngineTrace = false;
    for (const sess of sessions) {
      if (sess.trace_path === null) continue;
      const trace = await readTrace(sess.trace_path);
      if (trace === null) continue;
      const turns = (trace.turns ?? []).slice().reverse();
      for (const t of turns) {
        if (t.engineTrace !== undefined) sawEngineTrace = true;
        const sample = buildSample(sess.session_id, t, sess.started_at);
        if (sample !== null) {
          samples.push(sample);
          if (samples.length >= limit) break;
        }
      }
      if (samples.length >= limit) break;
    }
    const result: ExpressionSamplesResponse = {
      personaId,
      samples,
      developmentStub: !sawEngineTrace && samples.length === 0,
    };
    return result;
  });
};

export default s4Routes;
