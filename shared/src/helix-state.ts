/**
 * Helix State — Double Helix CASEL completo (DT-HELIX-01=A, Jun 27-abr).
 *
 * Port direto de ebrota/playbooks/CLAUDE_6.MD §5 + handoff
 * 2026-04-22-double-helix-mapping.md §6. Não simplifica: retrieval,
 * queue, deferred, boss, modo férias, dia 7 evaluatePairActivation.
 *
 * StatusMatrix coexiste, não substitui — helix declara dim ativa do
 * meta-ciclo de 18d entre dimensões; status-matrix dirige foco intra-sessão
 * por dimensão (brejo/baia/pasto). Em conflito, helix declara dim ativa,
 * StatusMatrix decide se dim alvo está bloqueada (brejo emocional → comfort).
 *
 * Spec: ascendimacy-ops/docs/specs/2026-04-27-statevector-primitives-inventory-f1.md §4
 * Sub-issue: ascendimacy-motor#37
 */

/** Dimensões CASEL canônicas. */
export const CASEL_DIMS = ["SA", "SM", "SOC", "REL", "DM"] as const;
export type CaselDim = (typeof CASEL_DIMS)[number];

/** Níveis Dreyfus mapeados pra CASEL (ebrota). */
export const CASEL_LEVELS = [
  "emerging",
  "developing",
  "demonstrating",
  "mastering",
] as const;
export type CaselLevel = (typeof CASEL_LEVELS)[number];

/**
 * Ordem default de rotação de dimensões em ciclos consecutivos.
 * Pedagogicamente curada: SA → SOC → SM → REL → DM.
 *
 * Quando `initHelix(userId, firstDim)` é chamado, a queue é construída
 * a partir desta ordem rotacional (firstDim ancora; restantes seguem
 * em ordem).
 */
export const DEFAULT_ROTATION_ORDER: CaselDim[] = [
  "SA",
  "SOC",
  "SM",
  "REL",
  "DM",
];

/** Default de duração estimada do ciclo (CLAUDE_6 §5: 14d ativos + 4d buffer). */
export const DEFAULT_CYCLE_DAYS = 18;

/** Threshold de progress que dispara retrieval gate (revisita dim anterior). */
export const RETRIEVAL_GATE_PROGRESS = 0.5;

/** Threshold de mood que bloqueia advance (CLAUDE_6 §5.3 buffer day). */
export const MOOD_BUFFER_THRESHOLD = 3;

/** Entrada de dimensão deferida (par não ativou; volta depois). */
export interface DeferredEntry {
  dimension: CaselDim;
  reason: string;
  /** ISO date — quando reconsiderar. Ex: após sucessor passar pelo boss. */
  retryAfter: string;
}

/**
 * Estado completo do Helix por user. Espelha schema ebrota
 * `kids_helix_state` + `previous_dimension` + `vacation_mode_active`.
 *
 * Persistido em postgres `helix_state` table (F1-bootstrap-db, motor#40).
 */
export interface HelixState {
  userId: string;
  activeDimension: CaselDim;
  activeLevel: CaselLevel;
  /** Progresso do ciclo atual em [0.0, 1.0]. */
  progress: number;
  /** Dia atual do ciclo (1..~estimatedCycleDays). */
  cycleDay: number;
  /** ISO date (YYYY-MM-DD) — início do ciclo atual. */
  cycleStart: string;
  /** Dimensão anterior — null no ciclo 1; populada após primeira rotação. */
  previousDimension: CaselDim | null;
  /** True após primeira sessão pós-progress >= 0.5 (retrieval ativada). */
  retrievalDone: boolean;
  /** Estimativa de duração do ciclo em dias (default DEFAULT_CYCLE_DAYS). */
  estimatedCycleDays: number;
  /** Fila de dimensões pra próximos ciclos. */
  queue: CaselDim[];
  /** Dimensões deferidas (par não ativou; volta depois). */
  deferred: DeferredEntry[];
  /** Dimensões já completadas (passaram pelo boss). */
  completed: CaselDim[];
  /** True quando criança está em modo férias (ciclo congela). */
  vacationModeActive: boolean;
}
