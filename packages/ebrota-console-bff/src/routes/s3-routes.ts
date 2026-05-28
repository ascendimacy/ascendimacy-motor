/**
 * S3 wiring — Motor de Decisão histórico por persona.
 *
 * Spec parent: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 *
 * Endpoints:
 *   GET /personas/:id/decision-history?limit=20  → últimas N decisões
 *   GET /personas/:id/jogada-distribution         → histogram jogada+method+register
 *   GET /personas/:id/decision-stats              → resumo agregado
 *
 * Fonte de dados: filesystem walk em EBROTA_BFF_TRACES_DIR (env) OU
 * opts.tracesDir. Lê engine-trace-v2 JSONs (qualquer *.json no tree),
 * filtra por persona, agrega.
 *
 * Vocabulário jogada (fixo): bridge / espelho / canal / diamante / arena
 * / recovery. Histogram sempre retorna as 6 chaves (zero quando ausente),
 * pra UI poder renderizar barras vazias sem branching.
 */

import type { FastifyPluginAsync } from "fastify";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface S3RoutesOptions {
  /** Override de EBROTA_BFF_TRACES_DIR pra testes. */
  tracesDir?: string;
}

export const JOGADA_VOCAB = [
  "bridge",
  "espelho",
  "canal",
  "diamante",
  "arena",
  "recovery",
] as const;

export type Jogada = (typeof JOGADA_VOCAB)[number];

export interface TacticDecisionSummary {
  jogada: string;
  angle: string;
  register: string;
  method: "rule" | "llm" | "fallback";
}

export interface DecisionRow {
  turnRef: string;
  decidedAt: string;
  decisionPath: string;
  selectedItemId: string;
  selectedItemType: string;
  selectedScore: number | null;
  poolSize: number;
  topNScores: number[];
  tacticDecision: TacticDecisionSummary | null;
  cacheHit: boolean;
  skipReason: string | null;
}

export interface JogadaDistribution {
  personaId: string;
  totalDecisions: number;
  byJogada: Record<Jogada, number>;
  byMethod: { rule: number; llm: number; fallback: number };
  byRegister: Record<string, number>;
  developmentStub: boolean;
}

export interface DecisionStats {
  personaId: string;
  totalTurns: number;
  cacheHitRate: number;
  fallbackRate: number;
  avgPoolSize: number;
  avgTopScore: number;
  selectorEscalations: number;
}

interface RawComponent {
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  method?: string;
}

interface RawWarning {
  component?: string;
  message?: string;
}

interface RawLlmCall {
  prompt_cache_hit?: boolean;
}

interface RawTurn {
  turnNumber?: number;
  turn?: number;
  timestamp?: string;
  engineTrace?: {
    components?: Record<string, RawComponent>;
    llm_calls?: RawLlmCall[];
    warnings?: RawWarning[];
    tactic_decision?: {
      jogada?: string;
      angle?: string;
      rationale?: string;
      constraints?: { register?: string };
    };
  };
  motorTrace?: {
    plan?: {
      contentPool?: Array<{
        item?: { id?: string; type?: string };
        score?: number;
      }>;
    };
    drota?: {
      selectedContent?: {
        item?: { id?: string; type?: string };
        score?: number;
      };
    };
  };
}

interface RawTrace {
  sessionId?: string;
  persona?: string;
  personaId?: string;
  turns?: RawTurn[];
}

async function* walkJson(dir: string): AsyncGenerator<string, void, void> {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const full = join(dir, name);
    if (entry.isDirectory()) {
      yield* walkJson(full);
    } else if (entry.isFile() && name.endsWith(".json")) {
      yield full;
    }
  }
}

async function loadTracesForPersona(
  tracesDir: string,
  personaId: string,
): Promise<RawTrace[]> {
  try {
    await stat(tracesDir);
  } catch {
    return [];
  }
  const out: RawTrace[] = [];
  for await (const path of walkJson(tracesDir)) {
    try {
      const raw = await readFile(path, "utf-8");
      const trace = JSON.parse(raw) as RawTrace;
      const tracePersona = trace.persona ?? trace.personaId;
      if (tracePersona !== personaId) continue;
      out.push(trace);
    } catch {
      // skip broken file, scan continues
    }
  }
  return out;
}

function extractDecisionRow(
  trace: RawTrace,
  turn: RawTurn,
): DecisionRow | null {
  const sessionId = trace.sessionId ?? "unknown";
  const turnNumber = turn.turnNumber ?? turn.turn ?? 0;
  const turnRef = `${sessionId}__turn_${turnNumber}`;
  const decidedAt = turn.timestamp ?? "1970-01-01T00:00:00Z";

  const et = turn.engineTrace ?? {};
  const selector = et.components?.["pragmatic_selector"];
  const tactician = et.components?.["tactician"];
  const motor = turn.motorTrace ?? {};
  const selected = motor.drota?.selectedContent;

  const selectorOut = selector?.outputs ?? {};
  const selectedIdFromSelector =
    typeof selectorOut["selected_id"] === "string"
      ? selectorOut["selected_id"]
      : undefined;
  const selectedItemId =
    selectedIdFromSelector ??
    (typeof selected?.item?.id === "string" ? selected.item.id : "");

  if (selectedItemId === "") return null;

  const selectedItemType =
    typeof selected?.item?.type === "string" ? selected.item.type : "unknown";
  const selectedScore =
    typeof selected?.score === "number" ? selected.score : null;

  const pool = motor.plan?.contentPool ?? [];
  const selectorIn = selector?.inputs ?? {};
  const poolSize =
    typeof selectorIn["pool_size"] === "number"
      ? selectorIn["pool_size"]
      : pool.length;

  const topNScores = pool
    .map((p) => (typeof p.score === "number" ? p.score : 0))
    .sort((a, b) => b - a)
    .slice(0, 5);

  const td = et.tactic_decision;
  const tactOut = tactician?.outputs ?? {};
  let tacticDecision: TacticDecisionSummary | null = null;
  const method = normalizeMethod(tactician?.method);
  const jogada =
    (typeof td?.jogada === "string" ? td.jogada : undefined) ??
    (typeof tactOut["jogada"] === "string" ? tactOut["jogada"] : undefined);
  if (jogada !== undefined) {
    const angle =
      (typeof td?.angle === "string" ? td.angle : undefined) ??
      (typeof tactOut["angle"] === "string" ? tactOut["angle"] : "") ??
      "";
    const register =
      typeof td?.constraints?.register === "string"
        ? td.constraints.register
        : "neutro";
    tacticDecision = { jogada, angle, register, method };
  }

  const decisionPath =
    tacticDecision !== null
      ? "tactician_split"
      : "pragmatic_selector_default";

  const cacheHit =
    Array.isArray(et.llm_calls) &&
    et.llm_calls.some((c) => c.prompt_cache_hit === true);

  const skipReason = findSkipReason(et.warnings);

  return {
    turnRef,
    decidedAt,
    decisionPath,
    selectedItemId,
    selectedItemType,
    selectedScore,
    poolSize,
    topNScores,
    tacticDecision,
    cacheHit,
    skipReason,
  };
}

function normalizeMethod(
  method: string | undefined,
): "rule" | "llm" | "fallback" {
  if (method === "rule" || method === "llm" || method === "fallback") {
    return method;
  }
  return "rule";
}

function findSkipReason(warnings: RawWarning[] | undefined): string | null {
  if (!Array.isArray(warnings)) return null;
  for (const w of warnings) {
    if (
      typeof w.message === "string" &&
      w.message.toLowerCase().includes("materializer")
    ) {
      return "materializer_fallback";
    }
  }
  return null;
}

function collectDecisions(traces: RawTrace[]): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const t of traces) {
    for (const turn of t.turns ?? []) {
      const row = extractDecisionRow(t, turn);
      if (row !== null) rows.push(row);
    }
  }
  // ordem decrescente por decidedAt; estável por turnRef como tie-breaker
  rows.sort((a, b) => {
    if (a.decidedAt !== b.decidedAt) {
      return a.decidedAt < b.decidedAt ? 1 : -1;
    }
    return a.turnRef < b.turnRef ? 1 : -1;
  });
  return rows;
}

function buildJogadaDistribution(
  personaId: string,
  rows: DecisionRow[],
): JogadaDistribution {
  const byJogada: Record<Jogada, number> = {
    bridge: 0,
    espelho: 0,
    canal: 0,
    diamante: 0,
    arena: 0,
    recovery: 0,
  };
  const byMethod = { rule: 0, llm: 0, fallback: 0 };
  const byRegister: Record<string, number> = {};
  let totalDecisions = 0;

  for (const row of rows) {
    if (row.tacticDecision === null) continue;
    totalDecisions += 1;
    const j = row.tacticDecision.jogada;
    if (isJogada(j)) byJogada[j] += 1;
    byMethod[row.tacticDecision.method] += 1;
    const reg = row.tacticDecision.register;
    byRegister[reg] = (byRegister[reg] ?? 0) + 1;
  }

  return {
    personaId,
    totalDecisions,
    byJogada,
    byMethod,
    byRegister,
    developmentStub: totalDecisions === 0,
  };
}

function isJogada(s: string): s is Jogada {
  return (JOGADA_VOCAB as readonly string[]).includes(s);
}

function buildStats(personaId: string, rows: DecisionRow[]): DecisionStats {
  const totalTurns = rows.length;
  if (totalTurns === 0) {
    return {
      personaId,
      totalTurns: 0,
      cacheHitRate: 0,
      fallbackRate: 0,
      avgPoolSize: 0,
      avgTopScore: 0,
      selectorEscalations: 0,
    };
  }
  let cacheHits = 0;
  let fallbacks = 0;
  let poolSizeSum = 0;
  let topScoreSum = 0;
  let topScoreCount = 0;
  let escalations = 0;
  for (const r of rows) {
    if (r.cacheHit) cacheHits += 1;
    if (r.tacticDecision?.method === "fallback") fallbacks += 1;
    if (r.tacticDecision?.method === "llm") escalations += 1;
    poolSizeSum += r.poolSize;
    if (r.selectedScore !== null) {
      topScoreSum += r.selectedScore;
      topScoreCount += 1;
    }
  }
  return {
    personaId,
    totalTurns,
    cacheHitRate: cacheHits / totalTurns,
    fallbackRate: fallbacks / totalTurns,
    avgPoolSize: poolSizeSum / totalTurns,
    avgTopScore: topScoreCount > 0 ? topScoreSum / topScoreCount : 0,
    selectorEscalations: escalations,
  };
}

const s3Routes: FastifyPluginAsync<S3RoutesOptions> = async (fastify, opts) => {
  const tracesDir =
    opts.tracesDir ?? process.env["EBROTA_BFF_TRACES_DIR"] ?? "";

  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/personas/:id/decision-history", async (req) => {
    if (tracesDir === "") {
      return { personaId: req.params.id, decisions: [] };
    }
    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 20;
    const traces = await loadTracesForPersona(tracesDir, req.params.id);
    const rows = collectDecisions(traces).slice(0, limit);
    return { personaId: req.params.id, decisions: rows };
  });

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/jogada-distribution",
    async (req) => {
      if (tracesDir === "") {
        return buildJogadaDistribution(req.params.id, []);
      }
      const traces = await loadTracesForPersona(tracesDir, req.params.id);
      const rows = collectDecisions(traces);
      return buildJogadaDistribution(req.params.id, rows);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/decision-stats",
    async (req) => {
      if (tracesDir === "") {
        return buildStats(req.params.id, []);
      }
      const traces = await loadTracesForPersona(tracesDir, req.params.id);
      const rows = collectDecisions(traces);
      return buildStats(req.params.id, rows);
    },
  );
};

export default s3Routes;
