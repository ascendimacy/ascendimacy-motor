/**
 * Variance — agregadores de KPI longitudinal pra H-AC-12 (ops#1058).
 *
 * Funções puras (kpis.ts) + renderer (report.ts) — consumidos pelo
 * `scripts/measure-menu-variance.mjs` e potencialmente por outros
 * agregadores (H-AC-08 painel futuro).
 */

export {
  computeCostStats,
  computeDistAlignment,
  computeKpis,
  deriveOutcome,
  emptyDistribution,
  klDivergence,
  KPI_THRESHOLDS_V0,
  normalizeDistribution,
  observedDistribution,
  passesV0Thresholds,
  type CostStats,
  type KpiSummary,
  type Outcome,
  type PlayedAsDistribution,
  type RunResult,
} from "./kpis.js";

export {
  renderReport,
  type CellInput,
  type ReportConfig,
} from "./report.js";
