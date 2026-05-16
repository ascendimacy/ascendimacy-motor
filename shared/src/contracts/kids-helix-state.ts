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
 *
 * G-07 extension (ops#1020) — ratified GO C 2026-05-16:
 *  - Cadence triggers (retrieval@day7, boss_fight@day14, midcycle_assessment@day7)
 *  - `last_trigger_fired` field + idempotency guard (não re-fire dentro do ciclo)
 *  - Reset implícito em `completeCycle` (cycles_completed++ → trigger limpo)
 *  - `activeCycleProgress()` (0..1 sobre 14d active phase) complementa
 *    `cycleProgress()` (0..1 sobre 18d total), porque "50%" no canon CLAUDE_6
 *    §5.2 refere-se a 50% da fase ativa (dia 7), não 50% do total (dia 9).
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

/**
 * Triggers cadenciais (G-07, ops#1020) — observados ao longo do ciclo.
 *
 * Spec canon CLAUDE_6 §5.2/§5.4: "Triggers adaptativos (não calendario):
 *  50% → retrieval, 100% → boss fight, dia 7 → avalia se ciclo precisa
 *  de 2 ou 4 semanas."
 *
 * - `retrieval_50` — dia 7 (50% do active phase, KIDS_HELIX_ACTIVE_DAYS/2).
 *   Drota deve puxar item do `previous_pair` pra retrieval link pedagógico.
 * - `boss_fight_100` — dia 14 (100% do active phase = início do buffer).
 *   Encerramento simbólico do ciclo; precede `completeCycle` (após buffer).
 * - `midcycle_assessment_7` — dia 7 também serve pra cycle-extension check
 *   (2 vs 4 semanas, per CLAUDE_6 §5.2/§5.4). Fires uma vez por ciclo,
 *   mesma fronteira do retrieval mas escopo diferente (recomendação operador).
 *
 * Persistido em `last_trigger_fired` pra idempotência (não re-fire dentro
 * do mesmo ciclo). Reset implícito em `completeCycle` (cycles_completed
 * incrementa, `last_trigger_fired` volta a null).
 */
export const KIDS_HELIX_CADENCE_TRIGGERS = [
  "retrieval_50",
  "boss_fight_100",
  "midcycle_assessment_7",
] as const;
export type KidsHelixCadenceTrigger =
  (typeof KIDS_HELIX_CADENCE_TRIGGERS)[number];

/**
 * Recomendação de extensão de ciclo após midcycle assessment (G-07 dia 7).
 *
 * - `standard_2_weeks` — manter ciclo padrão 14d active + 4d buffer.
 * - `extended_4_weeks` — dobrar ativo pra 28d (caso baixa progressão ou
 *   sinais de dificuldade). Implementação real do extend fica pra G-06+
 *   downstream (orchestrator decide); G-07 só emite a recomendação.
 *
 * Sub-decisão GO C: heurística conservative — só recomenda extension
 * quando evolution_assessment < threshold ou dim active em brejo.
 */
export const KIDS_HELIX_EXTENSION_RECOMMENDATIONS = [
  "standard_2_weeks",
  "extended_4_weeks",
] as const;
export type KidsHelixExtensionRecommendation =
  (typeof KIDS_HELIX_EXTENSION_RECOMMENDATIONS)[number];

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

  // -- Cadence triggers (G-07, ops#1020) --

  /**
   * Último trigger cadencial que fireou neste ciclo. Reset a `null` em
   * `completeCycle` (próximo ciclo limpa o slot). Garante idempotência:
   * trigger não re-fire se já foi observado dentro do mesmo ciclo.
   *
   * NOTA: G-07 permite múltiplos triggers no MESMO ciclo (retrieval@day7,
   * boss_fight@day14, midcycle_assessment@day7), por isso usamos array.
   * Decisão GO C: array sobre single slot — preserva audit + permite
   * combinações sem perda (ex: retrieval E midcycle_assessment no mesmo dia 7).
   */
  triggers_fired_this_cycle: KidsHelixCadenceTrigger[];

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
 * Dia canônico de retrieval trigger (G-07) — 50% da fase ativa (14/2 = 7).
 *
 * Cuidado: NÃO confundir com "50% do ciclo total" (18d → dia 9). Spec
 * CLAUDE_6 §5.2 refere-se à fase ATIVA quando fala "50% → retrieval".
 */
export const KIDS_HELIX_RETRIEVAL_TRIGGER_DAY = 7;

/**
 * Dia canônico de boss fight trigger (G-07) — 100% da fase ativa (= 14).
 * Boss fight precede `completeCycle` (que dispara em day 17 após buffer).
 */
export const KIDS_HELIX_BOSS_FIGHT_TRIGGER_DAY = 14;

/**
 * Dia canônico de midcycle assessment (G-07) — coincide com retrieval (dia 7).
 * Spec CLAUDE_6 §5.2/§5.4: "dia 7 → avalia se ciclo precisa de 2 ou 4 semanas".
 */
export const KIDS_HELIX_MIDCYCLE_ASSESSMENT_DAY = 7;

/**
 * Threshold de evolution percentage abaixo do qual midcycle_assessment
 * recomenda extended_4_weeks (sub-decisão GO C: conservative 30%).
 */
export const KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD = 0.3;

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
    triggers_fired_this_cycle: [],
    updated_at: args.nowIso,
  };
}
