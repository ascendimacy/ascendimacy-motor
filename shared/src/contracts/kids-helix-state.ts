/**
 * KidsHelixState — Double Helix cycle engine (G-05, ops#1091).
 *
 * Pair-based CASEL rotation: cada ciclo de ~18d tem um PAR de dimensões ativas
 * (vs. helix-state.ts legacy que era single-dim). 50% overlap entre ciclos
 * consecutivos preserva retrieval link pedagógico.
 *
 * **Distinção importante** vs. `shared/src/helix-state.ts` (HelixState):
 * - HelixState (legacy) = single `activeDimension` + retrieval da anterior.
 *   Origem: ebrota CLAUDE_6 §5 + helix-planner H1-H8. Persistido via
 *   helix-repo-memory (in-mem) ou postgres `helix_state` table (F1).
 * - KidsHelixState (este) = `active_pair` de 2 dims simultâneas + rotação
 *   50% overlap. Origem: ops#1091 spec ratified 2026-05-16 (CC defaults).
 *   Persistido via SQLite `kids_helix_state` table (motor-execucao).
 *
 * Ambos coexistem; HelixState não foi migrado para preservar callers
 * existentes (helix-planner.test.ts, helix-events.ts). G-05 introduz o
 * shape pair-based como vocabulário canônico do motor TS pós-ops#369
 * 4-layer architecture; futura convergência fica pra Tier 3.
 *
 * Spec: ascendimacy-ops/issues/1091 (4 sub-decisões ratified Jun 2026-05-16).
 * Capability parent: ops#990 C-T-10 + ops#989 C-T-09.
 * Downstream: ops#1020 G-07 cadência 18d (consome cycle_progress).
 */

import type { CaselDimension } from "../content-item.js";

/** Modo do ciclo helix — tri-state. */
export const KIDS_HELIX_MODES = ["active", "buffer", "vacation"] as const;
export type KidsHelixMode = (typeof KIDS_HELIX_MODES)[number];

/** Razões canônicas pra defer (move dim de `active` pra `deferred`). */
export const KIDS_HELIX_DEFER_REASONS = [
  "extended_brejo",
  "vacation_triggered",
  "parental_pause",
] as const;
export type KidsHelixDeferReason = (typeof KIDS_HELIX_DEFER_REASONS)[number];

/** Razões canônicas pra resume (move dim de `deferred` pra `queue`). */
export const KIDS_HELIX_RESUME_REASONS = [
  "recovery_confirmed",
  "parental_resume",
  "vacation_end",
] as const;
export type KidsHelixResumeReason = (typeof KIDS_HELIX_RESUME_REASONS)[number];

/** Razões canônicas pra entrada/saída de modo férias. */
export const KIDS_HELIX_VACATION_TRIGGERS = [
  "parental_request",
  "brejo_emotional_persistent",
  "sacrifice_exhaustion",
  "family_vacation_signal",
] as const;
export type KidsHelixVacationTrigger =
  (typeof KIDS_HELIX_VACATION_TRIGGERS)[number];

/** Par de dimensões CASEL — sempre 2 distintas. */
export type CaselDimensionPair = readonly [CaselDimension, CaselDimension];

/**
 * Estado completo do KidsHelix por persona (1 row por persona_id).
 *
 * Sub-decisão 1 ratified Jun 2026-05-16 (ops#1091 comment).
 */
export interface KidsHelixState {
  /** Persona id (chave). */
  persona_id: string;

  // -- Current cycle context --

  /** Par de 2 dims focadas neste ciclo. */
  active_pair: CaselDimensionPair;

  /** ISO timestamp — início do ciclo atual. */
  cycle_started_at: string;

  /** Dia corrente no ciclo, 0..17 (0-13 active, 14-17 buffer). */
  current_day: number;

  /** Fase do ciclo. */
  mode: KidsHelixMode;

  // -- History (G-07 50% trigger) --

  /** Par anterior — null no ciclo 1; populado após primeira rotação. */
  previous_pair: CaselDimensionPair | null;

  /** Total de ciclos fechados (completed → next). */
  cycles_completed: number;

  // -- Rotation queues --

  /** Dims aguardando próximo ciclo (ordem indica prioridade). */
  queue: CaselDimension[];

  /** Dims já cicladas (re-entram na queue ao completar todas 5). */
  completed: CaselDimension[];

  /** Dims pausadas (brejo, vacation, parental_pause). */
  deferred: CaselDimension[];

  // -- Modo férias --

  /**
   * Razão atual de vacation (quando `mode === "vacation"`). Permite caller
   * decidir condição de resume automática (ex: vacation_end signal só sai
   * se entrou por family_vacation_signal).
   */
  vacation_trigger: KidsHelixVacationTrigger | null;

  /** ISO timestamp — quando entrou em vacation (null se nunca). */
  vacation_started_at: string | null;

  /** Audit. */
  updated_at: string;
}

/** Duração ativa default do ciclo (dias 0..13). */
export const KIDS_HELIX_ACTIVE_DAYS = 14;

/** Duração total (ativos + buffer). */
export const KIDS_HELIX_TOTAL_DAYS = 18;

/** Threshold de brejo emocional consecutivo pra trigger vacation. */
export const KIDS_HELIX_BREJO_VACATION_DAYS = 5;

/** Threshold de brejo simples pra defer dim (sub-decisão 3). */
export const KIDS_HELIX_BREJO_DEFER_DAYS = 3;

/** Threshold de sacrifice exhaustion consecutiva pra trigger vacation. */
export const KIDS_HELIX_SACRIFICE_EXHAUSTION_SESSIONS = 3;

/** Default fallback pair quando G-02 baseline ausente (Brota Mestre foundational). */
export const KIDS_HELIX_DEFAULT_FALLBACK_PAIR: CaselDimensionPair = ["SA", "SOC"];

/**
 * Bootstrap state pra persona nova. Caller (state-manager) usa quando
 * `kids_helix_state` row ainda não existe.
 *
 * Sub-decisão 2: initial pair = highest-need + complementary-engagement.
 * Caller passa `firstPair` opcional resolvido a partir de G-02/status_matrix;
 * se ausente, usa fallback SA+SOC.
 */
export function defaultKidsHelixState(args: {
  personaId: string;
  nowIso: string;
  firstPair?: CaselDimensionPair;
}): KidsHelixState {
  const pair = args.firstPair ?? KIDS_HELIX_DEFAULT_FALLBACK_PAIR;
  // Queue = dims restantes na ordem canônica que não estão no par inicial.
  const allDims: CaselDimension[] = ["SA", "SM", "SOC", "REL", "DM"];
  const queue = allDims.filter((d) => d !== pair[0] && d !== pair[1]);
  return {
    persona_id: args.personaId,
    active_pair: pair,
    cycle_started_at: args.nowIso,
    current_day: 0,
    mode: "active",
    previous_pair: null,
    cycles_completed: 0,
    queue,
    completed: [],
    deferred: [],
    vacation_trigger: null,
    vacation_started_at: null,
    updated_at: args.nowIso,
  };
}
