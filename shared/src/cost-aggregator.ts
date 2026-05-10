/**
 * Cost aggregator — agrega DebugEventLine[] em totais por mês/persona/run/modelo.
 *
 * Sprint 0 PR2 (motor#73). Story ops#501 (S-J-01-04).
 * Capability: ops#483 (C-J-01).
 *
 * Uso típico (script de relatório operacional):
 *   import { aggregateCostsFromNdjson } from "@ascendimacy/shared";
 *   const r = aggregateCostsFromNdjson("logs/debug/yuji-pilot/events.ndjson",
 *                                       { user_id: "ryo", month: "2026-05" });
 *   console.log(`Custo Ryo em 2026-05: $${r.total_cost_usd.toFixed(4)}`);
 */

import { readFileSync } from "node:fs";

/** Subset de DebugEventLine que aggregator consome. Definido localmente para
 * desacoplar do schema completo — facilita testes com fixtures sintéticos. */
export interface DebugEventLineLike {
  run_id: string;
  seq: number;
  ts: string;
  side: "sts" | "motor";
  step: string;
  user_id: string;
  model: string | null;
  tokens: { in: number; out: number; reasoning: number } | null;
  cost_usd_est: number | null;
}

export interface CostAggregateFilter {
  /** Filtra por user_id (persona). */
  user_id?: string;
  /** Filtra por run_id. */
  run_id?: string;
  /** Filtra por mês ISO YYYY-MM. */
  month?: string;
  /** Filtra por side. */
  side?: "sts" | "motor";
  /** Filtra por step. */
  step?: string;
}

export interface ModelBreakdown {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  event_count: number;
}

export interface CostAggregateResult {
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: number;
  event_count: number;
  /** Breakdown por modelo. Events com model=null entram em chave `__no_model__`. */
  by_model: Record<string, ModelBreakdown>;
  /** Filter aplicado, ecoado para auditoria. Vazio se nenhum filtro. */
  filter: CostAggregateFilter;
}

/** Sentinela para events sem modelo declarado (steps stub, etc.). */
const NO_MODEL_KEY = "__no_model__";

function matchesFilter(event: DebugEventLineLike, filter: CostAggregateFilter): boolean {
  if (filter.user_id != null && event.user_id !== filter.user_id) return false;
  if (filter.run_id != null && event.run_id !== filter.run_id) return false;
  if (filter.side != null && event.side !== filter.side) return false;
  if (filter.step != null && event.step !== filter.step) return false;
  if (filter.month != null) {
    // Match YYYY-MM no início de event.ts (ISO 8601)
    if (!event.ts.startsWith(filter.month)) return false;
  }
  return true;
}

function emptyBreakdown(): ModelBreakdown {
  return { tokens_in: 0, tokens_out: 0, cost_usd: 0, event_count: 0 };
}

/** Agrega array de events, opcionalmente filtrado, em totais + breakdown por modelo.
 *
 * - `cost_usd_est = null` é ignorado na soma de cost (mas conta no event_count).
 * - `tokens = null` é ignorado na soma de tokens.
 * - Modelo ausente (`null`) vira chave `__no_model__` no breakdown. */
export function aggregateCosts(
  events: readonly DebugEventLineLike[],
  filter: CostAggregateFilter = {},
): CostAggregateResult {
  const result: CostAggregateResult = {
    total_tokens_in: 0,
    total_tokens_out: 0,
    total_cost_usd: 0,
    event_count: 0,
    by_model: {},
    filter,
  };

  for (const event of events) {
    if (!matchesFilter(event, filter)) continue;
    result.event_count += 1;

    const tokensIn = event.tokens?.in ?? 0;
    const tokensOut = event.tokens?.out ?? 0;
    result.total_tokens_in += tokensIn;
    result.total_tokens_out += tokensOut;

    if (event.cost_usd_est != null) {
      result.total_cost_usd += event.cost_usd_est;
    }

    const modelKey = event.model ?? NO_MODEL_KEY;
    if (!result.by_model[modelKey]) {
      result.by_model[modelKey] = emptyBreakdown();
    }
    const bucket = result.by_model[modelKey]!;
    bucket.event_count += 1;
    bucket.tokens_in += tokensIn;
    bucket.tokens_out += tokensOut;
    if (event.cost_usd_est != null) {
      bucket.cost_usd += event.cost_usd_est;
    }
  }

  return result;
}

/** Carrega NDJSON de disco e agrega. Linhas vazias e malformadas são ignoradas
 * silenciosamente (resiliência: NDJSON pode ter trailing newline ou linhas
 * corrompidas em casos extremos). */
export function aggregateCostsFromNdjson(
  ndjsonPath: string,
  filter: CostAggregateFilter = {},
): CostAggregateResult {
  const content = readFileSync(ndjsonPath, "utf-8");
  const events: DebugEventLineLike[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed) as DebugEventLineLike;
      events.push(parsed);
    } catch {
      // Linha malformada — ignora e segue. Em produção isso indica trace
      // corrompido (cf. ops#398 F1-G5 — gaps + dups).
      continue;
    }
  }
  return aggregateCosts(events, filter);
}
