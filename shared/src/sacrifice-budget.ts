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
