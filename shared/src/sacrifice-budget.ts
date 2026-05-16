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
// G-22 Sacrifice fórmula — Jun ratify B 2026-05-16 + remaining gaps (ops#1033).
//
// Gaps cobertos (motor#124, base): 1 (base_effort), 2 (consumption_mult),
//   3 (sensitivity_mult), 4 (challenge_mult), 8 (budget_exhausted soft degrade),
//   9 (trust ratio).
//
// Gaps cobertos (este PR, CC defaults inline aguardando ratify):
//   - Gap 5 outcome_mult — last feedback_signal event → multiplier
//   - Gap 6 onda semanal enforcement — day-of-week multiplier
//     (canon Mon leve → Wed pico1 → Thu recov → Fri pico2)
//   - Gap 7 onda ciclo enforcement — cycle-day multiplier
//     (canon d1-3 min → d4-7 cresc → d8-10 PICO → d11-14 plateau → buffer recov)
//   - Gap 10 cap/floor enforcement — MAX/MIN sobre total cost
//     (cycle-reservoir multi-session pendente; per-item bounds shipped)
//
// Formula completa:
//   raw_total = base × consumption × sensitivity × challenge × outcome × weekly × cycle
//   total = clamp(raw_total, MIN_SINGLE_ITEM_COST, MAX_SINGLE_ITEM_COST)
//
// Backward-compat: todos novos params são opcionais; default = 1.0 (não-enforcement)
// pra manter assinatura motor#124 verde.
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

// -----------------------------------------------------------------------------
// G-22 Gap 5 outcome_mult (CC default Jun 2026-05-16, aguardando ratify).
// -----------------------------------------------------------------------------
//
// Canon CLAUDE_6 §D24 "Recovery: ação bem recebida +2 | mal recebida -3 |
// silêncio: congela" — esses números são deltas DE BUDGET (já cobertos por
// `recoverBudget`). Para outcome_mult sobre CUSTO da próxima oferta, CC
// extrapola: outcome positivo → multiplier maior (crianca engajada, suporta
// mais); negativo → menor (precisa softer); silêncio → reduzido (cautela);
// missing → neutro.
//
// CC defaults aguardando ratify Jun (alternativas:
//   (A) ZERO impacto sem signal explícito (1.0 always)
//   (B) Mapping abaixo (CC default)
//   (C) Inverter (positivo=0.9 pra dar break, negativo=1.1 pra forçar)
// CC escolheu (B) pq alinha com dose-response pedagógico standard.
export const OUTCOME_MULTIPLIERS = {
  positive_engagement: 1.1,
  negative_engagement: 0.7,
  silence: 0.9,
  unknown: 1.0,
} as const;

export type OutcomeSignal = keyof typeof OUTCOME_MULTIPLIERS;

/** Tipos canônicos de events que carregam outcome signal. */
export const OUTCOME_FEEDBACK_EVENT_TYPES = ["feedback_signal"] as const;

/** Janela máxima (em turns/events) pra considerar último outcome relevante. */
export const OUTCOME_LOOKBACK_TURNS = 5;

// -----------------------------------------------------------------------------
// G-22 Gap 6 onda semanal (CC default Jun 2026-05-16, aguardando ratify).
// -----------------------------------------------------------------------------
//
// Canon CLAUDE_6 §D24: "Onda semanal seg(leve)→qua(pico 1)→qui(recov)→sex(pico 2)".
// CC interpola valores conservadores (0.8..1.2) — mantém variação ≤±20%:
//   Mon (1) = 0.8 (leve)        — semana começa, easing
//   Tue (2) = 0.9               — crescendo
//   Wed (3) = 1.2 (pico 1)      — pico mid-week
//   Thu (4) = 0.85 (recovery)   — pós-pico cool-down
//   Fri (5) = 1.15 (pico 2)     — pico final pré-weekend
//   Sat (6) = 0.95              — weekend default
//   Sun (0) = 0.9               — pre-week prep
//
// JavaScript Date.getDay(): 0=Sun, 1=Mon, ..., 6=Sat.
export const WEEKLY_WAVE_MULTIPLIERS: Record<number, number> = {
  0: 0.9,  // Sunday
  1: 0.8,  // Monday (leve)
  2: 0.9,  // Tuesday
  3: 1.2,  // Wednesday (pico 1)
  4: 0.85, // Thursday (recovery)
  5: 1.15, // Friday (pico 2)
  6: 0.95, // Saturday
};

// -----------------------------------------------------------------------------
// G-22 Gap 7 onda ciclo 18d (CC default Jun 2026-05-16, aguardando ratify).
// -----------------------------------------------------------------------------
//
// Canon CLAUDE_6 §D24: "Onda ciclo (18d): 1-3 mínimo → 4-7 crescente →
// 8-10 PICO → 11-14 plateau". KidsHelixState.current_day é 0-indexed (0..17,
// 0-13 active phase, 14-17 buffer). Canon usa 1-indexed (1-14 active, 15-18
// buffer). Mapeamento 0-indexed: d0-2=mínimo, d3-6=crescente, d7-9=PICO,
// d10-13=plateau, d14-17=buffer.
//
// CC values mantém variação ≤±30% pra evitar surpresas drásticas:
//   d0-2  (mínimo)   = 0.7
//   d3-6  (crescente) = 0.85  — single average; mais granular seria 0.8..0.9 ramp
//   d7-9  (PICO)     = 1.3
//   d10-13 (plateau) = 1.0
//   d14-17 (buffer)  = 0.6   — recovery / consolidação
//
// CC defaults aguardando ratify Jun (alternativas:
//   (A) Single ramp via current_day/14 fórmula contínua (smoothing)
//   (B) Discrete tiers como acima (CC default — espelha canon literal)
//   (C) Ignorar cycle wave (1.0 always) até spec quantitativo
// CC escolheu (B) pq canon usa nomes discretos (mínimo/crescente/PICO/plateau).
export function getCycleWaveMultiplier(cycleDayZeroIndexed: number): number {
  if (cycleDayZeroIndexed < 0) return 1.0;
  if (cycleDayZeroIndexed <= 2) return 0.7;   // d1-3 mínimo
  if (cycleDayZeroIndexed <= 6) return 0.85;  // d4-7 crescente
  if (cycleDayZeroIndexed <= 9) return 1.3;   // d8-10 PICO
  if (cycleDayZeroIndexed <= 13) return 1.0;  // d11-14 plateau
  if (cycleDayZeroIndexed <= 17) return 0.6;  // d15-18 buffer
  return 1.0; // fora do range esperado — defensive
}

// -----------------------------------------------------------------------------
// G-22 Gap 10 cap/floor enforcement (CC default Jun 2026-05-16, aguardando ratify).
// -----------------------------------------------------------------------------
//
// Canon menciona "cap/floor" sem números concretos. CC default:
//   MAX_SINGLE_ITEM_COST = 50  — evita item degenerar pra cost absurdo quando
//                                multipliers se compõem (e.g., Saki sensory
//                                1.5 × firm 1.3 × peak 1.3 × pico-sem 1.2 ≈
//                                3× base; com base=20 → 60 sem cap)
//   MIN_SINGLE_ITEM_COST = 1   — evita zero/negativo quando multipliers de
//                                supressão se compõem (e.g., buffer 0.6 ×
//                                soft 0.8 × low-sens 0.7 ≈ 0.34 sem floor)
//
// **Cycle reservoir multi-session NÃO shipped** (gap honest). Spec menciona
// "cumulative budget per cycle" mas não fornece formula concreta — CC opted
// por per-item bounds only, deferred reservoir pra v3 quando spec maturar.
export const MAX_SINGLE_ITEM_COST = 50;
export const MIN_SINGLE_ITEM_COST = 1;

/**
 * G-22 input ao cômputo de custo per-challenge.
 *
 * @field item               — fonte de `sacrifice_amount` (Gap 1 base_effort).
 * @field personaSensitivity — Gap 3; default "medium" se ausente.
 * @field intensity          — Gap 4 fonte primária; ISA label se disponível.
 * @field recentUsageCount   — Gap 2; vem do content_usage_repo (motor#108) na janela 14d.
 * @field cycleTargetSessions — Gap 2 denominador; default 28.
 * @field outcomeSignal      — Gap 5; resolved via deriveOutcomeSignal(eventLog).
 * @field weekday            — Gap 6; 0=Sun..6=Sat (JS Date.getDay()). Undefined→1.0.
 * @field cycleDay           — Gap 7; 0..17 (KidsHelixState.current_day). Undefined→1.0.
 * @field enforceBounds      — Gap 10; quando true (default), clamp [MIN, MAX]. Tests podem disable.
 */
export interface ChallengeCostInput {
  item: { sacrifice_amount?: number };
  personaSensitivity?: SensitivityLevel;
  intensity?: ChallengeIntensity;
  recentUsageCount?: number;
  cycleTargetSessions?: number;
  outcomeSignal?: OutcomeSignal;
  weekday?: number;
  cycleDay?: number;
  enforceBounds?: boolean;
}

/** G-22 breakdown — útil pra observability (contextHints + telemetry). */
export interface ChallengeCostBreakdown {
  baseEffort: number;
  consumptionMult: number;
  sensitivityMult: number;
  challengeMult: number;
  outcomeMult: number;
  weeklyMult: number;
  cycleMult: number;
  rawTotal: number;
  total: number;
  /** True se Gap 10 clamp aplicou (MAX ou MIN bound triggered). */
  bounded: boolean;
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

  // Gap 5: outcome_mult (default 1.0 quando ausente)
  const outcomeMult = input.outcomeSignal
    ? OUTCOME_MULTIPLIERS[input.outcomeSignal]
    : 1.0;

  // Gap 6: weekly_mult (default 1.0 quando weekday undefined)
  const weeklyMult =
    typeof input.weekday === "number" && WEEKLY_WAVE_MULTIPLIERS[input.weekday] !== undefined
      ? WEEKLY_WAVE_MULTIPLIERS[input.weekday]!
      : 1.0;

  // Gap 7: cycle_mult (default 1.0 quando cycleDay undefined)
  const cycleMult =
    typeof input.cycleDay === "number" ? getCycleWaveMultiplier(input.cycleDay) : 1.0;

  const rawTotal =
    baseEffort *
    consumptionMult *
    sensitivityMult *
    challengeMult *
    outcomeMult *
    weeklyMult *
    cycleMult;

  // Gap 10: cap/floor enforcement (default enabled)
  const enforceBounds = input.enforceBounds !== false; // default true
  let total = rawTotal;
  let bounded = false;
  if (enforceBounds) {
    if (rawTotal > MAX_SINGLE_ITEM_COST) {
      total = MAX_SINGLE_ITEM_COST;
      bounded = true;
    } else if (rawTotal < MIN_SINGLE_ITEM_COST) {
      total = MIN_SINGLE_ITEM_COST;
      bounded = true;
    }
  }

  return {
    baseEffort,
    consumptionMult,
    sensitivityMult,
    challengeMult,
    outcomeMult,
    weeklyMult,
    cycleMult,
    rawTotal,
    total,
    bounded,
  };
}

/**
 * Gap 5 helper — extrai outcome signal mais recente do eventLog.
 *
 * Procura events de tipo em OUTCOME_FEEDBACK_EVENT_TYPES (canon: "feedback_signal")
 * nos últimos OUTCOME_LOOKBACK_TURNS (5) events. Retorna o `signal_type` do mais
 * recente, ou "unknown" quando nenhum encontrado.
 *
 * `signal_type` esperado: "positive_engagement" | "negative_engagement" | "silence".
 * Valores fora do enum → "unknown" (defensive).
 *
 * Caller passa eventLog cronológico (mais antigo primeiro, padrão SessionState).
 */
export function deriveOutcomeSignal(
  eventLog: ReadonlyArray<{ type: string; data: Record<string, unknown> }>,
): OutcomeSignal {
  if (!eventLog || eventLog.length === 0) return "unknown";
  const feedbackTypes = OUTCOME_FEEDBACK_EVENT_TYPES as readonly string[];
  // Itera do mais recente pro mais antigo, max OUTCOME_LOOKBACK_TURNS
  const start = Math.max(0, eventLog.length - OUTCOME_LOOKBACK_TURNS);
  for (let i = eventLog.length - 1; i >= start; i--) {
    const ev = eventLog[i]!;
    if (feedbackTypes.includes(ev.type)) {
      const raw = ev.data?.["signal_type"];
      if (
        raw === "positive_engagement" ||
        raw === "negative_engagement" ||
        raw === "silence"
      ) {
        return raw;
      }
      return "unknown"; // event existe mas signal_type inválido
    }
  }
  return "unknown";
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
