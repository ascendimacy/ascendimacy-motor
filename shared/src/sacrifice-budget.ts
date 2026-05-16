/**
 * Sacrifice Budget — custo/orçamento por sessão.
 *
 * Spec: motor-drota-v1.md §3 + statevector-primitives-inventory-f1 §3
 * Sub-issue: ascendimacy-motor#36
 *
 * Decisões (Jun, 27-abr):
 * - DT-BUDGET-01: baseline configurável per-profile via BudgetConfig
 * - DT-BUDGET-02: deduction síncrona no select (determinismo + replay)
 *
 * Baselines por produto (spec §3):
 *   Kids: 15 | Corporativa: 25-30 | Individual: 20
 *
 * Modifiers:
 *   mood >= 7  → +5   | mood < 5   → -5
 *   trust >= 0.8 → +3 | trust < 0.5 → -5
 *   crisis_flag  → cap 5 (modo mínimo forçado)
 *
 * Costs típicos por action type:
 *   pergunta simples: 2-4   | reconhecimento: 1-2  | humor: 1-3
 *   pergunta sentimento: 6-10 | quest offline: 8-12
 *   reflexão: 10-15         | confronto: 15-25
 *
 * Recovery:
 *   ação bem recebida: +2 | mal recebida: -3 | silêncio: congela
 *
 * Exhaustion: budget <= 0 → modo mínimo (cost <= MINIMUM_MODE_CAP)
 */

import type { SessionState } from "./types.js";

export const MINIMUM_MODE_CAP = 2;
export const MOOD_HIGH_BONUS = 5;
export const MOOD_HIGH_THRESHOLD = 7;
export const MOOD_LOW_PENALTY = -5;
export const MOOD_LOW_THRESHOLD = 5;
export const TRUST_HIGH_BONUS = 3;
export const TRUST_HIGH_THRESHOLD = 0.8;
export const TRUST_LOW_PENALTY = -5;
export const TRUST_LOW_THRESHOLD = 0.5;
export const CRISIS_CAP = 5;

/**
 * Configuração de budget per-profile.
 * DT-BUDGET-01: configurável via voice-profile (futura integração Pulso).
 */
export interface BudgetConfig {
  /** Budget base antes dos modifiers. Kids=15, Corp=25-30, Individual=20. */
  baseline: number;
  /** Se true, budget é capeado em CRISIS_CAP independente de modifiers. */
  crisisFlag?: boolean;
}

/**
 * Inicializa budget para a sessão aplicando baseline + modifiers de mood e trust.
 */
export function initBudget(
  config: BudgetConfig,
  mood = 5,
  trust = 0.5,
): number {
  let budget = config.baseline;
  if (mood >= MOOD_HIGH_THRESHOLD) {
    budget += MOOD_HIGH_BONUS;
  } else if (mood < MOOD_LOW_THRESHOLD) {
    budget += MOOD_LOW_PENALTY;
  }
  if (trust >= TRUST_HIGH_THRESHOLD) {
    budget += TRUST_HIGH_BONUS;
  } else if (trust < TRUST_LOW_THRESHOLD) {
    budget += TRUST_LOW_PENALTY;
  }
  if (config.crisisFlag) {
    budget = Math.min(budget, CRISIS_CAP);
  }
  return Math.max(0, Math.round(budget));
}

/**
 * Deduz amount do budgetRemaining. Função pura — retorna novo SessionState.
 * DT-BUDGET-02: síncrona (chamada direto no select).
 */
export function deductBudget(
  state: SessionState,
  amount = 0,
): SessionState {
  return { ...state, budgetRemaining: Math.max(0, state.budgetRemaining - amount) };
}

/**
 * Recupera delta de budget após feedback. Função pura.
 * Recovery spec: ação bem recebida +2; mal recebida -3.
 */
export function recoverBudget(
  state: SessionState,
  delta: number,
): SessionState {
  return { ...state, budgetRemaining: Math.max(0, state.budgetRemaining + delta) };
}

/** True quando budget <= 0 → motor entra em modo mínimo. */
export function isExhausted(state: SessionState): boolean {
  return state.budgetRemaining <= 0;
}

/** Cap de custo máximo em modo mínimo. */
export function getMinimumModeCap(): number {
  return MINIMUM_MODE_CAP;
}

/**
 * True se item pode ser selecionado dado o budget atual.
 * Modo normal: sempre true. Modo mínimo: só cost <= MINIMUM_MODE_CAP.
 */
export function canAfford(
  state: SessionState,
  sacrificeAmount: number,
): boolean {
  if (!isExhausted(state)) return true;
  return sacrificeAmount <= MINIMUM_MODE_CAP;
}

// =============================================================================
// G-22 Sacrifice fórmula PARCIAL — Jun ratify B 2026-05-16 (ops#1033).
//
// Gaps cobertos: 1 (base_effort), 2 (consumption_mult), 3 (sensitivity_mult),
// 4 (challenge_mult), 8 (budget_exhausted soft degrade), 9 (trust ratio).
//
// Deferred (NÃO implementado nesta tier):
//   - Gap 5 outcome_mult (precisa canonization signal — v2 separate)
//   - Gap 6 onda semanal enforcement (depends G-05/G-07)
//   - Gap 7 onda ciclo enforcement (depends G-05/G-07)
//   - Gap 10 boss fight override (depends G-07 ratify)
//
// Formula: base_effort × consumption_mult × sensitivity_mult × challenge_mult
// (outcome_mult slot reservado, returns 1.0 enquanto deferred)
// =============================================================================

/** G-22 ratified Jun 2026-05-16 — sensitivity multiplier values (Gap 3). */
export const SENSITIVITY_MULTIPLIERS = {
  low: 0.7,
  medium: 1.0,
  high: 1.3,
  sensory: 1.5,
} as const;

export type SensitivityLevel = keyof typeof SENSITIVITY_MULTIPLIERS;

/** G-22 ratified Jun 2026-05-16 — challenge intensity multiplier values (Gap 4). */
export const INTENSITY_MULTIPLIERS = {
  soft: 0.8,
  medium: 1.0,
  firm: 1.3,
} as const;

export type ChallengeIntensity = keyof typeof INTENSITY_MULTIPLIERS;

/** G-22 ratified Jun 2026-05-16 — consumption decay parameters (Gap 2). */
export const CONSUMPTION_WINDOW_DAYS = 14;
export const CONSUMPTION_DECAY_FACTOR = 0.3;
export const CONSUMPTION_MIN = 0.5;
export const CONSUMPTION_MAX = 1.5;
/** Default cycle target sessions (14 dias × 2 sessões/dia). */
export const DEFAULT_CYCLE_TARGET_SESSIONS = 28;

/** G-22 ratified — base_effort default quando item.sacrifice_amount ausente (Gap 1). */
export const BASE_EFFORT_DEFAULT = 8;

/** G-22 ratified — soft degrade threshold quando budget esgotado (Gap 8). */
export const BUDGET_EXHAUSTED_MAX_SACRIFICE = 7;

/** G-22 ratified — trust ratio prazer/sacrifice formula coefficients (Gap 9). */
export const TRUST_RATIO_BASE = 0.7;
export const TRUST_RATIO_SLOPE = 0.6;

/** G-22 — sacrifice_amount magnitude thresholds para challenge_mult fallback (Gap 4). */
export const CHALLENGE_AMOUNT_FIRM_THRESHOLD = 15;
export const CHALLENGE_AMOUNT_SOFT_THRESHOLD = 7;

/**
 * G-22 input ao cômputo de custo per-challenge.
 *
 * @field item               — fonte de `sacrifice_amount` (Gap 1 base_effort).
 * @field personaSensitivity — Gap 3; default "medium" se ausente.
 * @field intensity          — Gap 4 fonte primária; ISA label se disponível.
 * @field recentUsageCount   — Gap 2; vem do content_usage_repo (motor#108) na janela 14d.
 * @field cycleTargetSessions — Gap 2 denominador; default 28.
 */
export interface ChallengeCostInput {
  item: { sacrifice_amount?: number };
  personaSensitivity?: SensitivityLevel;
  intensity?: ChallengeIntensity;
  recentUsageCount?: number;
  cycleTargetSessions?: number;
}

/** G-22 breakdown — útil pra observability (contextHints + telemetry). */
export interface ChallengeCostBreakdown {
  baseEffort: number;
  consumptionMult: number;
  sensitivityMult: number;
  challengeMult: number;
  total: number;
}

/**
 * G-22 (ratified Jun 2026-05-16, ops#1033) — calcula custo de sacrifício per-challenge.
 *
 * Formula: base × consumption × sensitivity × challenge.
 *
 * Gap 1 base_effort:
 *   - item.sacrifice_amount preferido; fallback BASE_EFFORT_DEFAULT (8) quando ausente.
 *
 * Gap 2 consumption_mult:
 *   - `1.0 - (recent_usage_count / cycle_target × DECAY_FACTOR)` clamp [0.5, 1.5].
 *   - Higher recent use → saturation → multiplier menor.
 *
 * Gap 3 sensitivity_mult:
 *   - persona.profile.sensitivity ∈ {low, medium, high, sensory}; default "medium".
 *
 * Gap 4 challenge_mult:
 *   - ISA intensity primary (soft/medium/firm).
 *   - Fallback: sacrifice_amount magnitude proxy (≥15→firm, ≤7→soft, else medium).
 *
 * @returns breakdown completo (cada componente exposto pra observability).
 */
export function computeChallengeCost(input: ChallengeCostInput): ChallengeCostBreakdown {
  // Gap 1: base_effort
  const baseEffort = input.item.sacrifice_amount ?? BASE_EFFORT_DEFAULT;

  // Gap 2: consumption_mult
  const target = input.cycleTargetSessions ?? DEFAULT_CYCLE_TARGET_SESSIONS;
  const recent = input.recentUsageCount ?? 0;
  const consumptionRaw = 1.0 - (recent / target) * CONSUMPTION_DECAY_FACTOR;
  const consumptionMult = Math.max(
    CONSUMPTION_MIN,
    Math.min(CONSUMPTION_MAX, consumptionRaw),
  );

  // Gap 3: sensitivity_mult
  const sensitivity = input.personaSensitivity ?? "medium";
  const sensitivityMult = SENSITIVITY_MULTIPLIERS[sensitivity];

  // Gap 4: challenge_mult — ISA intensity primary; sacrifice_amount magnitude fallback.
  let challengeMult: number;
  if (input.intensity) {
    challengeMult = INTENSITY_MULTIPLIERS[input.intensity];
  } else if (baseEffort >= CHALLENGE_AMOUNT_FIRM_THRESHOLD) {
    challengeMult = INTENSITY_MULTIPLIERS.firm;
  } else if (baseEffort <= CHALLENGE_AMOUNT_SOFT_THRESHOLD) {
    challengeMult = INTENSITY_MULTIPLIERS.soft;
  } else {
    challengeMult = INTENSITY_MULTIPLIERS.medium;
  }

  const total = baseEffort * consumptionMult * sensitivityMult * challengeMult;
  return { baseEffort, consumptionMult, sensitivityMult, challengeMult, total };
}

/**
 * Gap 9 (ratified Jun 2026-05-16) — trust ratio prazer/sacrifice.
 *
 * Formula: prazer_quota = clamp(0.7 - trust × 0.6, 0, 1); sacrifice_quota = 1 - prazer_quota.
 *
 * Exemplos:
 *   trust=0.0 → prazer=0.7, sacrifice=0.3 (relação nova, alto prazer)
 *   trust=0.5 → prazer=0.4, sacrifice=0.6 (equilíbrio)
 *   trust=1.0 → prazer=0.1, sacrifice=0.9 (confiança alta, sacrifício alto)
 *
 * Output é **selection priority hint** via contextHints.prazer_sacrifice_ratio,
 * NÃO multiplier direto no scoring (drota interpreta).
 */
export function computeTrustRatio(
  trustLevel: number,
): { prazerQuota: number; sacrificeQuota: number } {
  const prazerRaw = TRUST_RATIO_BASE - trustLevel * TRUST_RATIO_SLOPE;
  const prazerQuota = Math.max(0, Math.min(1, prazerRaw));
  const sacrificeQuota = 1 - prazerQuota;
  return { prazerQuota, sacrificeQuota };
}

/**
 * Gap 8 (ratified Jun 2026-05-16) — soft degrade item filter.
 *
 * Quando budget esgotado (budgetRemaining <= 0): planner deve restringir
 * recommendation a items com sacrifice_amount ≤ BUDGET_EXHAUSTED_MAX_SACRIFICE (7).
 *
 * NÃO hard stop — apenas filtra; sessão continua. Telemetry event
 * `budget_exhausted_soft_degrade` deve ser logado pelo caller quando ativo.
 */
export function isItemAllowedUnderBudgetExhaustion(
  item: { sacrifice_amount?: number },
): boolean {
  return (item.sacrifice_amount ?? BASE_EFFORT_DEFAULT) <= BUDGET_EXHAUSTED_MAX_SACRIFICE;
}

/**
 * Extrai sensitivity da persona.profile com safe default.
 * persona.profile.sensitivity é open-shape (Record<string, unknown>) — runtime check.
 */
export function extractPersonaSensitivity(
  profile: Record<string, unknown> | undefined | null,
): SensitivityLevel {
  if (!profile) return "medium";
  const raw = profile["sensitivity"];
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "sensory") {
    return raw;
  }
  return "medium";
}
