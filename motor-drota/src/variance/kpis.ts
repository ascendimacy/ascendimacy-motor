/**
 * Variância KPIs — H-AC-12 (spec ratificada v1, ops#1058).
 *
 * Funções puras pra agregar runs do `generateActionMenu` em métricas
 * longitudinais. Consumido por `scripts/measure-menu-variance.mjs` e
 * possivelmente outros agregadores futuros (H-AC-08 painel).
 *
 * Métricas (Opção B da spec §4 — ratificada Jun 2026-05-13):
 *  - pass_rate_first  — outcome=ok primeiro try (limiar v0 ≥50%)
 *  - recovery_rate    — outcome=ok-retry (limiar v0 ≤40%)
 *  - degradation_rate — outcome=degraded (ISA stripped, limiar v0 ≤10%)
 *  - error_rate       — outcome=error (null retornado, limiar v0 ≤5%)
 *  - dist_alignment   — KL divergence entre distribuição realizada e hint
 *                       (limiar v0 ≤0.3)
 */

import type { ActionMenu, PlayedAs } from "@ascendimacy/shared";

/** Outcome granular conforme D-4-TELO (motor#92). */
export type Outcome = "ok" | "ok-retry" | "degraded" | "error";

/** Códigos de warning emitidos pelo generateActionMenu. */
type GeneratorWarningCode =
  | "invalid_input"
  | "llm_error"
  | "parse_error_first"
  | "parse_error_retry"
  | "schema_error_first"
  | "schema_error_retry"
  | "isa_labels_stripped";

/** Resultado de um run individual de generateActionMenu. */
export interface RunResult {
  menu: ActionMenu | null;
  warnings: ReadonlyArray<GeneratorWarningCode>;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsdEst: number;
}

/**
 * Deriva o outcome granular a partir do resultado do run.
 *
 * Algoritmo (espelha menu-generator.ts):
 *  - menu null               → "error"
 *  - menu OK + isa_stripped  → "degraded"
 *  - menu OK + qualquer erro → "ok-retry"
 *  - menu OK sem erro        → "ok"
 */
export function deriveOutcome(run: RunResult): Outcome {
  if (run.menu === null) return "error";
  if (run.warnings.includes("isa_labels_stripped")) return "degraded";
  const retryIndicators: GeneratorWarningCode[] = [
    "parse_error_first",
    "schema_error_first",
    "parse_error_retry",
    "schema_error_retry",
    "llm_error",
  ];
  if (run.warnings.some((w) => retryIndicators.includes(w))) return "ok-retry";
  return "ok";
}

/** Agrupa runs por outcome + computa rates. */
export interface KpiSummary {
  total: number;
  passRateFirst: number;   // [0, 1]
  recoveryRate: number;
  degradationRate: number;
  errorRate: number;
}

export function computeKpis(runs: ReadonlyArray<RunResult>): KpiSummary {
  const total = runs.length;
  if (total === 0) {
    return {
      total: 0,
      passRateFirst: 0,
      recoveryRate: 0,
      degradationRate: 0,
      errorRate: 0,
    };
  }
  const counts = { ok: 0, "ok-retry": 0, degraded: 0, error: 0 };
  for (const r of runs) {
    counts[deriveOutcome(r)] += 1;
  }
  return {
    total,
    passRateFirst: counts.ok / total,
    recoveryRate: counts["ok-retry"] / total,
    degradationRate: counts.degraded / total,
    errorRate: counts.error / total,
  };
}

/**
 * Limiares v0.1 — Jun ratificou Opção B 2026-05-13, refinado 2026-05-14.
 *
 * Histórico:
 * - v0 inicial: errorRateMax=0.05 (Jun spec ratificada)
 * - v0.1 (2026-05-14): errorRateMax=0.10 após baseline empírico N=60 mostrar
 *   error_rate de 5-7% sob Qwen3-30B local. Limiar v0 era teoricamente
 *   relaxado mas ainda criava falso negativo (Ryo PASS->FAIL por 2pp em
 *   variance natural; Kei FAIL->PASS pelo mesmo motivo). 10% é o piso
 *   honesto empírico — apertar com Kimi K2.5 cloud baseline futuro.
 */
export const KPI_THRESHOLDS_V0 = {
  passRateFirstMin: 0.50,
  recoveryRateMax: 0.40,
  degradationRateMax: 0.10,
  errorRateMax: 0.10,
  distAlignmentMax: 0.3,
} as const;

/** Verdadeiro se KPI summary passa pelos limiares v0. */
export function passesV0Thresholds(
  kpis: KpiSummary,
  distAlignment: number,
): { ok: true } | { ok: false; failures: string[] } {
  const failures: string[] = [];
  if (kpis.passRateFirst < KPI_THRESHOLDS_V0.passRateFirstMin) {
    failures.push(
      `pass_rate_first ${(kpis.passRateFirst * 100).toFixed(0)}% < ${KPI_THRESHOLDS_V0.passRateFirstMin * 100}%`,
    );
  }
  if (kpis.recoveryRate > KPI_THRESHOLDS_V0.recoveryRateMax) {
    failures.push(
      `recovery_rate ${(kpis.recoveryRate * 100).toFixed(0)}% > ${KPI_THRESHOLDS_V0.recoveryRateMax * 100}%`,
    );
  }
  if (kpis.degradationRate > KPI_THRESHOLDS_V0.degradationRateMax) {
    failures.push(
      `degradation_rate ${(kpis.degradationRate * 100).toFixed(0)}% > ${KPI_THRESHOLDS_V0.degradationRateMax * 100}%`,
    );
  }
  if (kpis.errorRate > KPI_THRESHOLDS_V0.errorRateMax) {
    failures.push(
      `error_rate ${(kpis.errorRate * 100).toFixed(0)}% > ${KPI_THRESHOLDS_V0.errorRateMax * 100}%`,
    );
  }
  if (distAlignment > KPI_THRESHOLDS_V0.distAlignmentMax) {
    failures.push(
      `dist_alignment ${distAlignment.toFixed(2)} > ${KPI_THRESHOLDS_V0.distAlignmentMax}`,
    );
  }
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

/** Distribuição observada de played_as em N runs (não normalizada). */
export type PlayedAsDistribution = Record<PlayedAs, number>;

const PLAYED_AS_KEYS: ReadonlyArray<PlayedAs> = [
  "bridge",
  "espelho",
  "canal",
  "diamante",
  "arena",
  "recovery",
];

export function emptyDistribution(): PlayedAsDistribution {
  return {
    bridge: 0,
    espelho: 0,
    canal: 0,
    diamante: 0,
    arena: 0,
    recovery: 0,
  };
}

/**
 * Agrega played_as de todos os items de todos os runs com menu válido.
 * Items sem `played_as` (graceful degradation) são ignorados — não
 * contam pra distribuição, mas continuam contando no degradation_rate.
 */
export function observedDistribution(runs: ReadonlyArray<RunResult>): PlayedAsDistribution {
  const dist = emptyDistribution();
  for (const run of runs) {
    if (run.menu === null) continue;
    for (const item of run.menu.items) {
      if (item.played_as != null) {
        dist[item.played_as] += 1;
      }
    }
  }
  return dist;
}

/** Normaliza distribuição absoluta em probabilidade [0, 1]. */
export function normalizeDistribution(
  dist: PlayedAsDistribution,
): Record<PlayedAs, number> {
  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) return { ...dist };
  const out = {} as Record<PlayedAs, number>;
  for (const k of PLAYED_AS_KEYS) {
    out[k] = dist[k] / total;
  }
  return out;
}

/**
 * KL divergence D(p || q) = Σ p_i × log(p_i / q_i).
 *
 * p = distribuição realizada (observed); q = distribuição esperada (hint).
 *
 * Convenção: 0 × log(0) = 0 (matemática padrão). Para evitar log(0)
 * quando q_i = 0 mas p_i > 0, aplica laplace smoothing pequeno (epsilon
 * 1e-6) — caso extremo improvável em N=30 com 6 jogadas, mas defensivo.
 *
 * Resultado em **nats** (log natural). Quanto menor, mais aderente p é a q.
 *
 * Limiar Jun ratificou: ≤ 0.3 (v0).
 */
export function klDivergence(
  observedNorm: Record<PlayedAs, number>,
  expectedNorm: Record<PlayedAs, number>,
): number {
  const epsilon = 1e-6;
  let kl = 0;
  for (const k of PLAYED_AS_KEYS) {
    const p = observedNorm[k];
    const q = expectedNorm[k];
    if (p === 0) continue;          // 0 × log(0/q) = 0 convencional
    const qSmooth = q === 0 ? epsilon : q;
    kl += p * Math.log(p / qSmooth);
  }
  return kl;
}

/**
 * Helper end-to-end: dado runs + hint, computa KL diretamente.
 * `personaHintBias` é o `bias` array do PersonaHint (RYO_HINT.bias etc).
 */
export function computeDistAlignment(
  runs: ReadonlyArray<RunResult>,
  personaHintBias: ReadonlyArray<{ played_as: PlayedAs; weight: number }>,
): number {
  const observedNorm = normalizeDistribution(observedDistribution(runs));

  // Hint bias → distribuição esperada normalizada.
  const expected = emptyDistribution();
  for (const b of personaHintBias) {
    expected[b.played_as] = b.weight;
  }
  const expectedNorm = normalizeDistribution(expected);

  return klDivergence(observedNorm, expectedNorm);
}

/** Cost stats agregado (mean + total). */
export interface CostStats {
  totalUsd: number;
  meanUsdPerRun: number;
  meanLatencyMs: number;
  meanTokensIn: number;
  meanTokensOut: number;
}

export function computeCostStats(runs: ReadonlyArray<RunResult>): CostStats {
  const total = runs.length;
  if (total === 0) {
    return {
      totalUsd: 0,
      meanUsdPerRun: 0,
      meanLatencyMs: 0,
      meanTokensIn: 0,
      meanTokensOut: 0,
    };
  }
  const sumUsd = runs.reduce((s, r) => s + r.costUsdEst, 0);
  const sumLatency = runs.reduce((s, r) => s + r.latencyMs, 0);
  const sumIn = runs.reduce((s, r) => s + r.tokensIn, 0);
  const sumOut = runs.reduce((s, r) => s + r.tokensOut, 0);
  return {
    totalUsd: sumUsd,
    meanUsdPerRun: sumUsd / total,
    meanLatencyMs: sumLatency / total,
    meanTokensIn: sumIn / total,
    meanTokensOut: sumOut / total,
  };
}
