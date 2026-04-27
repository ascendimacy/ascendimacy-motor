/**
 * aggregate-gateway-logs — métricas de validação Nagareyama 14d (motor#28e).
 *
 * Lê N arquivos NDJSON gerados pelo llm-gateway logger e calcula métricas
 * de success rate. Crítério close motor#28: ≥90% em ambas métricas.
 *
 * Métrica B (turn-level success):
 *   Agrupa events por run_id (= 1 turn STS). Turn é "full" se tem ≥3
 *   eventos cobrindo planejador + drota + signal-extractor. Turn é
 *   "success" se NENHUM desses 3 events tem was_fallback=true E
 *   nenhum tem outcome="error".
 *
 * Métrica C (E2E SLA proxy):
 *   Soma latency_ms dos events do mesmo run_id. Proxy razoável pra SLA
 *   WhatsApp (LLM é componente dominante; orchestrator + rede WhatsApp
 *   adicionam <1s). Threshold default: 15000ms (configurável).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LlmProvider } from "@ascendimacy/shared";

export interface GatewayLogEntry {
  ts: string;
  request_id: string;
  run_id: string;
  step: string;
  provider: LlmProvider;
  model: string;
  tokens: { in: number; out: number; reasoning?: number };
  latency_ms: number;
  attempt_count: number;
  outcome: "ok" | "error" | "fallback_used";
  error_class: string | null;
  was_fallback: boolean;
  primary_provider_attempted: LlmProvider | null;
  bucket_level_at_start?: number;
  bucket_level_at_end?: number;
}

export interface TurnAgg {
  run_id: string;
  events: GatewayLogEntry[];
  steps: Set<string>;
  total_latency_ms: number;
  any_fallback: boolean;
  any_error: boolean;
  is_full: boolean; // tem ≥3 dos 3 steps obrigatórios
}

/**
 * Default = pipeline completo do motor's próprio orchestrator (motor#25).
 * STS orchestrator pula signal-extractor → use ["planejador", "drota"] via
 * AggregateOptions.requiredSteps quando rodando contra NDJSON do STS.
 */
const REQUIRED_STEPS_FOR_FULL_TURN_DEFAULT = ["planejador", "drota", "signal-extractor"] as const;

export interface AggregateOptions {
  /** Latency threshold ms pra Métrica C. Default 15000. */
  e2eSlaMs?: number;
  /** Filtra apenas run_ids matching prefix (ex: "nagareyama-14d"). */
  runIdPrefix?: string;
  /**
   * Steps obrigatórios pra um turn ser "full" (motor#28f).
   * Default = motor's own orchestrator pipeline (3 steps).
   * STS context: passar ["planejador", "drota"] (sem signal-extractor).
   */
  requiredSteps?: string[];
}

export interface AggregateReport {
  range: { from: string | null; to: string | null };
  /** Steps obrigatórios pra "full turn" (motor#28f). */
  required_steps: string[];
  total_events: number;
  total_turns_observed: number;
  total_turns_full: number;
  metric_b_turn_level: { passed: number; total: number; rate: number };
  metric_c_e2e_sla: { passed: number; total: number; rate: number; threshold_ms: number };
  latency: {
    by_step: Record<string, { p50: number; p95: number; p99: number; n: number }>;
  };
  provider_mix: Record<string, number>;
  fallback_events: { count: number; by_step: Record<string, number> };
  error_events: { count: number; by_class: Record<string, number> };
}

function parseNdjsonFile(path: string): GatewayLogEntry[] {
  const content = readFileSync(path, "utf-8");
  const out: GatewayLogEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as GatewayLogEntry);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/**
 * Lê todos *.ndjson sob `dir` (não recursivo) e retorna events concatenados.
 * Filtra por runIdPrefix se passado.
 */
export function loadEventsFromDir(dir: string, runIdPrefix?: string): GatewayLogEntry[] {
  if (!statSync(dir).isDirectory()) {
    throw new Error(`not a directory: ${dir}`);
  }
  const out: GatewayLogEntry[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ndjson")) continue;
    const events = parseNdjsonFile(join(dir, f));
    for (const e of events) {
      if (runIdPrefix && !e.run_id.startsWith(runIdPrefix)) continue;
      out.push(e);
    }
  }
  return out;
}

export function groupByRunId(
  events: GatewayLogEntry[],
  requiredSteps: readonly string[] = REQUIRED_STEPS_FOR_FULL_TURN_DEFAULT,
): Map<string, TurnAgg> {
  const turns = new Map<string, TurnAgg>();
  for (const e of events) {
    let t = turns.get(e.run_id);
    if (!t) {
      t = {
        run_id: e.run_id,
        events: [],
        steps: new Set(),
        total_latency_ms: 0,
        any_fallback: false,
        any_error: false,
        is_full: false,
      };
      turns.set(e.run_id, t);
    }
    t.events.push(e);
    t.steps.add(e.step);
    t.total_latency_ms += e.latency_ms;
    if (e.was_fallback) t.any_fallback = true;
    if (e.outcome === "error") t.any_error = true;
  }
  for (const t of turns.values()) {
    t.is_full = requiredSteps.every((s) => t.steps.has(s));
  }
  return turns;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function computeReport(
  events: GatewayLogEntry[],
  opts: AggregateOptions = {},
): AggregateReport {
  const e2eSlaMs = opts.e2eSlaMs ?? 15_000;
  const requiredSteps = opts.requiredSteps ?? [...REQUIRED_STEPS_FOR_FULL_TURN_DEFAULT];

  const turns = groupByRunId(events, requiredSteps);
  const fullTurns = [...turns.values()].filter((t) => t.is_full);

  // Métrica B
  const bPassed = fullTurns.filter((t) => !t.any_fallback && !t.any_error).length;

  // Métrica C
  const cPassed = fullTurns.filter((t) => t.total_latency_ms < e2eSlaMs).length;

  // Latency p50/p95/p99 by step
  const byStep: Record<string, number[]> = {};
  for (const e of events) {
    if (!byStep[e.step]) byStep[e.step] = [];
    byStep[e.step]!.push(e.latency_ms);
  }
  const latencyByStep: Record<string, { p50: number; p95: number; p99: number; n: number }> = {};
  for (const [step, lats] of Object.entries(byStep)) {
    latencyByStep[step] = {
      p50: percentile(lats, 50),
      p95: percentile(lats, 95),
      p99: percentile(lats, 99),
      n: lats.length,
    };
  }

  // Provider mix
  const providerMix: Record<string, number> = {};
  for (const e of events) {
    providerMix[e.provider] = (providerMix[e.provider] ?? 0) + 1;
  }

  // Fallback events
  let fallbackCount = 0;
  const fallbackByStep: Record<string, number> = {};
  for (const e of events) {
    if (e.was_fallback) {
      fallbackCount += 1;
      fallbackByStep[e.step] = (fallbackByStep[e.step] ?? 0) + 1;
    }
  }

  // Error events
  let errorCount = 0;
  const errorByClass: Record<string, number> = {};
  for (const e of events) {
    if (e.outcome === "error") {
      errorCount += 1;
      const key = e.error_class ?? "unknown";
      errorByClass[key] = (errorByClass[key] ?? 0) + 1;
    }
  }

  // Range
  const tss = events.map((e) => e.ts).sort();
  const from = tss[0] ?? null;
  const to = tss[tss.length - 1] ?? null;

  return {
    range: { from, to },
    required_steps: [...requiredSteps],
    total_events: events.length,
    total_turns_observed: turns.size,
    total_turns_full: fullTurns.length,
    metric_b_turn_level: {
      passed: bPassed,
      total: fullTurns.length,
      rate: fullTurns.length > 0 ? bPassed / fullTurns.length : 0,
    },
    metric_c_e2e_sla: {
      passed: cPassed,
      total: fullTurns.length,
      rate: fullTurns.length > 0 ? cPassed / fullTurns.length : 0,
      threshold_ms: e2eSlaMs,
    },
    latency: { by_step: latencyByStep },
    provider_mix: providerMix,
    fallback_events: { count: fallbackCount, by_step: fallbackByStep },
    error_events: { count: errorCount, by_class: errorByClass },
  };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function pass(rate: number, threshold = 0.9): string {
  return rate >= threshold ? "✓ PASS" : "✗ FAIL";
}

export function formatReportMarkdown(report: AggregateReport): string {
  const lines: string[] = [];
  lines.push(`# llm-gateway aggregate report`);
  lines.push(``);
  lines.push(`**Range**: ${report.range.from ?? "n/a"} → ${report.range.to ?? "n/a"}`);
  lines.push(`**Required steps for full turn**: ${report.required_steps.join(", ")}`);
  lines.push(``);
  lines.push(`## Volume`);
  lines.push(`- Total events: ${report.total_events}`);
  lines.push(`- Turns observed: ${report.total_turns_observed}`);
  lines.push(`- Turns full (≥${report.required_steps.length} required steps): ${report.total_turns_full}`);
  lines.push(``);
  lines.push(`## Métrica B — turn-level success (≥90% = pass)`);
  const b = report.metric_b_turn_level;
  lines.push(`- ${b.passed}/${b.total} turns sem fallback E sem error → **${pct(b.rate)}** ${pass(b.rate)}`);
  lines.push(``);
  lines.push(`## Métrica C — E2E SLA proxy (≥90% = pass)`);
  const c = report.metric_c_e2e_sla;
  lines.push(`- ${c.passed}/${c.total} turns com latency total < ${c.threshold_ms}ms → **${pct(c.rate)}** ${pass(c.rate)}`);
  lines.push(``);
  lines.push(`## Latency p50/p95/p99 por step`);
  lines.push(`| step | n | p50 (ms) | p95 (ms) | p99 (ms) |`);
  lines.push(`|---|---|---|---|---|`);
  for (const [step, l] of Object.entries(report.latency.by_step).sort()) {
    lines.push(`| ${step} | ${l.n} | ${l.p50} | ${l.p95} | ${l.p99} |`);
  }
  lines.push(``);
  lines.push(`## Provider mix`);
  for (const [p, n] of Object.entries(report.provider_mix).sort((a, b) => b[1] - a[1])) {
    const total = report.total_events;
    lines.push(`- ${p}: ${n} (${pct(n / total)})`);
  }
  lines.push(``);
  lines.push(`## Fallback events`);
  lines.push(`- Total: ${report.fallback_events.count}`);
  if (report.fallback_events.count > 0) {
    for (const [step, n] of Object.entries(report.fallback_events.by_step).sort((a, b) => b[1] - a[1])) {
      lines.push(`  - ${step}: ${n}`);
    }
  }
  lines.push(``);
  lines.push(`## Error events`);
  lines.push(`- Total: ${report.error_events.count}`);
  if (report.error_events.count > 0) {
    for (const [klass, n] of Object.entries(report.error_events.by_class).sort((a, b) => b[1] - a[1])) {
      lines.push(`  - ${klass}: ${n}`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}
