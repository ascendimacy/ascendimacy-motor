/**
 * Tests para sacrifice-budget (motor#36).
 *
 * Cobre: initBudget (baseline + modifiers), deductBudget (puro/imutável),
 * recoverBudget, isExhausted, canAfford.
 */

import { describe, it, expect } from "vitest";
import {
  initBudget,
  deductBudget,
  recoverBudget,
  isExhausted,
  canAfford,
  getMinimumModeCap,
  MINIMUM_MODE_CAP,
  CRISIS_CAP,
  computeChallengeCost,
  computeTrustRatio,
  isItemAllowedUnderBudgetExhaustion,
  extractPersonaSensitivity,
  SENSITIVITY_MULTIPLIERS,
  INTENSITY_MULTIPLIERS,
  CONSUMPTION_MIN,
  CONSUMPTION_MAX,
  BASE_EFFORT_DEFAULT,
  BUDGET_EXHAUSTED_MAX_SACRIFICE,
  DEFAULT_CYCLE_TARGET_SESSIONS,
} from "../src/sacrifice-budget.js";
import type { SessionState } from "../src/types.js";

function makeState(budgetRemaining: number): SessionState {
  return {
    sessionId: "test-session",
    trustLevel: 0.5,
    budgetRemaining,
    eventLog: [],
    turn: 1,
  };
}

describe("initBudget", () => {
  it("aplica baseline sem modifiers (mood=5, trust=0.5 neutros)", () => {
    expect(initBudget({ baseline: 15 }, 5, 0.5)).toBe(15);
  });

  it("mood >= 7 adiciona MOOD_HIGH_BONUS", () => {
    expect(initBudget({ baseline: 15 }, 7, 0.5)).toBe(20);
    expect(initBudget({ baseline: 15 }, 10, 0.5)).toBe(20);
  });

  it("mood < 5 aplica MOOD_LOW_PENALTY", () => {
    expect(initBudget({ baseline: 15 }, 4, 0.5)).toBe(10);
    expect(initBudget({ baseline: 15 }, 1, 0.5)).toBe(10);
  });

  it("trust >= 0.8 adiciona TRUST_HIGH_BONUS", () => {
    expect(initBudget({ baseline: 15 }, 5, 0.8)).toBe(18);
    expect(initBudget({ baseline: 15 }, 5, 1.0)).toBe(18);
  });

  it("trust < 0.5 aplica TRUST_LOW_PENALTY", () => {
    expect(initBudget({ baseline: 15 }, 5, 0.3)).toBe(10);
    expect(initBudget({ baseline: 15 }, 5, 0.0)).toBe(10);
  });

  it("crisisFlag capeia em CRISIS_CAP independente de modifiers", () => {
    expect(initBudget({ baseline: 15, crisisFlag: true }, 5, 0.5)).toBe(CRISIS_CAP);
    expect(initBudget({ baseline: 30, crisisFlag: true }, 10, 1.0)).toBe(CRISIS_CAP);
  });

  it("combina mood alto + trust alto corretamente", () => {
    // baseline 15 + mood_bonus 5 + trust_bonus 3 = 23
    expect(initBudget({ baseline: 15 }, 8, 0.9)).toBe(23);
  });

  it("nao vai abaixo de zero mesmo com penalidades grandes", () => {
    expect(initBudget({ baseline: 5 }, 1, 0.1)).toBeGreaterThanOrEqual(0);
  });
});

describe("deductBudget", () => {
  it("reduz budgetRemaining imutavelmente", () => {
    const state = makeState(15);
    const next = deductBudget(state, 4);
    expect(next.budgetRemaining).toBe(11);
    expect(state.budgetRemaining).toBe(15); // original inalterado
  });

  it("nao vai abaixo de zero", () => {
    const state = makeState(3);
    expect(deductBudget(state, 10).budgetRemaining).toBe(0);
  });

  it("amount 0 nao altera budget", () => {
    const state = makeState(15);
    expect(deductBudget(state, 0).budgetRemaining).toBe(15);
  });

  it("preserva outros campos do state", () => {
    const state = makeState(15);
    const next = deductBudget(state, 5);
    expect(next.sessionId).toBe(state.sessionId);
    expect(next.turn).toBe(state.turn);
  });
});

describe("recoverBudget", () => {
  it("adiciona delta positivo (acao bem recebida +2)", () => {
    const state = makeState(10);
    expect(recoverBudget(state, 2).budgetRemaining).toBe(12);
  });

  it("remove delta negativo (acao mal recebida -3)", () => {
    const state = makeState(10);
    expect(recoverBudget(state, -3).budgetRemaining).toBe(7);
  });

  it("nao vai abaixo de zero", () => {
    const state = makeState(2);
    expect(recoverBudget(state, -10).budgetRemaining).toBe(0);
  });
});

describe("isExhausted", () => {
  it("retorna true quando budgetRemaining === 0", () => {
    expect(isExhausted(makeState(0))).toBe(true);
  });

  it("retorna false quando budget > 0", () => {
    expect(isExhausted(makeState(1))).toBe(false);
    expect(isExhausted(makeState(15))).toBe(false);
  });
});

describe("canAfford", () => {
  it("modo normal: aceita qualquer custo", () => {
    const state = makeState(15);
    expect(canAfford(state, 20)).toBe(true);
    expect(canAfford(state, 0)).toBe(true);
  });

  it("modo minimo (exaurido): aceita cost <= MINIMUM_MODE_CAP", () => {
    const state = makeState(0);
    expect(canAfford(state, MINIMUM_MODE_CAP)).toBe(true);
    expect(canAfford(state, MINIMUM_MODE_CAP + 1)).toBe(false);
  });
});

describe("getMinimumModeCap", () => {
  it("retorna MINIMUM_MODE_CAP", () => {
    expect(getMinimumModeCap()).toBe(MINIMUM_MODE_CAP);
  });
});

// =============================================================================
// G-22 Sacrifice fórmula PARCIAL — Jun ratify B 2026-05-16 (ops#1033).
// =============================================================================

describe("computeChallengeCost — Gap 1 base_effort", () => {
  it("usa item.sacrifice_amount quando presente", () => {
    const out = computeChallengeCost({ item: { sacrifice_amount: 12 } });
    expect(out.baseEffort).toBe(12);
  });

  it("usa BASE_EFFORT_DEFAULT (8) quando sacrifice_amount undefined", () => {
    const out = computeChallengeCost({ item: {} });
    expect(out.baseEffort).toBe(BASE_EFFORT_DEFAULT);
    expect(out.baseEffort).toBe(8);
  });
});

describe("computeChallengeCost — Gap 2 consumption_mult", () => {
  it("recent=0 → multiplier ~1.0 (zero saturation)", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      recentUsageCount: 0,
    });
    expect(out.consumptionMult).toBeCloseTo(1.0, 5);
  });

  it("recent > 0 reduz multiplier proporcionalmente", () => {
    // recent=14, target=28: 1.0 - (14/28 × 0.3) = 1.0 - 0.15 = 0.85
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      recentUsageCount: 14,
      cycleTargetSessions: 28,
    });
    expect(out.consumptionMult).toBeCloseTo(0.85, 5);
  });

  it("clamp inferior em CONSUMPTION_MIN (0.5)", () => {
    // Hammered use: recent way above target → raw could go below 0.5
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      recentUsageCount: 100,
      cycleTargetSessions: 28,
    });
    expect(out.consumptionMult).toBe(CONSUMPTION_MIN);
  });

  it("usa DEFAULT_CYCLE_TARGET_SESSIONS (28) quando target undefined", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      recentUsageCount: 28, // = cycle target exato
    });
    // 1.0 - (28/28 × 0.3) = 0.7
    expect(out.consumptionMult).toBeCloseTo(0.7, 5);
    expect(DEFAULT_CYCLE_TARGET_SESSIONS).toBe(28);
  });

  it("clamp respeita CONSUMPTION_MAX teórico (não atingível com fórmula atual)", () => {
    // Fórmula raw = 1 - (n/target × 0.3) ≤ 1.0 sempre; max só vira relevante se
    // futura calibração introduzir bonus. Sanity check defensivo.
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      recentUsageCount: 0,
    });
    expect(out.consumptionMult).toBeLessThanOrEqual(CONSUMPTION_MAX);
  });
});

describe("computeChallengeCost — Gap 3 sensitivity_mult", () => {
  it("low → 0.7", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      personaSensitivity: "low",
    });
    expect(out.sensitivityMult).toBe(SENSITIVITY_MULTIPLIERS.low);
    expect(out.sensitivityMult).toBe(0.7);
  });

  it("medium → 1.0 (default)", () => {
    const explicit = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      personaSensitivity: "medium",
    });
    const defaulted = computeChallengeCost({ item: { sacrifice_amount: 10 } });
    expect(explicit.sensitivityMult).toBe(1.0);
    expect(defaulted.sensitivityMult).toBe(1.0);
  });

  it("high → 1.3", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      personaSensitivity: "high",
    });
    expect(out.sensitivityMult).toBe(1.3);
  });

  it("sensory (Saki) → 1.5", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      personaSensitivity: "sensory",
    });
    expect(out.sensitivityMult).toBe(1.5);
  });
});

describe("computeChallengeCost — Gap 4 challenge_mult", () => {
  it("ISA intensity 'soft' → 0.8", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      intensity: "soft",
    });
    expect(out.challengeMult).toBe(INTENSITY_MULTIPLIERS.soft);
    expect(out.challengeMult).toBe(0.8);
  });

  it("ISA intensity 'medium' → 1.0", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      intensity: "medium",
    });
    expect(out.challengeMult).toBe(1.0);
  });

  it("ISA intensity 'firm' → 1.3", () => {
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      intensity: "firm",
    });
    expect(out.challengeMult).toBe(1.3);
  });

  it("fallback magnitude: sacrifice_amount ≥15 → firm (1.3)", () => {
    const out = computeChallengeCost({ item: { sacrifice_amount: 18 } });
    expect(out.challengeMult).toBe(1.3);
  });

  it("fallback magnitude: sacrifice_amount ≤7 → soft (0.8)", () => {
    const out = computeChallengeCost({ item: { sacrifice_amount: 5 } });
    expect(out.challengeMult).toBe(0.8);
  });

  it("fallback magnitude: 8-14 → medium (1.0)", () => {
    const out = computeChallengeCost({ item: { sacrifice_amount: 10 } });
    expect(out.challengeMult).toBe(1.0);
  });

  it("fallback magnitude: undefined sacrifice_amount → default base 8 → medium", () => {
    const out = computeChallengeCost({ item: {} });
    expect(out.baseEffort).toBe(8);
    expect(out.challengeMult).toBe(1.0);
  });
});

describe("computeChallengeCost — composição total", () => {
  it("multiplica todos componentes corretamente", () => {
    // base=10, consumption≈1.0 (recent=0), sensitivity=1.0 (medium), challenge=1.0
    const out = computeChallengeCost({
      item: { sacrifice_amount: 10 },
      personaSensitivity: "medium",
      intensity: "medium",
      recentUsageCount: 0,
    });
    expect(out.total).toBeCloseTo(10.0, 5);
  });

  it("composição realista Saki sensory + firm + uso médio", () => {
    // base=15, consumption=0.85 (recent=14/28), sensitivity=1.5, challenge=1.3
    // total = 15 × 0.85 × 1.5 × 1.3 = 24.86...
    const out = computeChallengeCost({
      item: { sacrifice_amount: 15 },
      personaSensitivity: "sensory",
      intensity: "firm",
      recentUsageCount: 14,
      cycleTargetSessions: 28,
    });
    expect(out.total).toBeCloseTo(15 * 0.85 * 1.5 * 1.3, 5);
  });
});

describe("computeTrustRatio — Gap 9", () => {
  it("trust=0.0 → prazer=0.7, sacrifice=0.3", () => {
    const out = computeTrustRatio(0.0);
    expect(out.prazerQuota).toBeCloseTo(0.7, 5);
    expect(out.sacrificeQuota).toBeCloseTo(0.3, 5);
  });

  it("trust=0.5 → prazer=0.4, sacrifice=0.6", () => {
    const out = computeTrustRatio(0.5);
    expect(out.prazerQuota).toBeCloseTo(0.4, 5);
    expect(out.sacrificeQuota).toBeCloseTo(0.6, 5);
  });

  it("trust=1.0 → prazer=0.1, sacrifice=0.9", () => {
    const out = computeTrustRatio(1.0);
    expect(out.prazerQuota).toBeCloseTo(0.1, 5);
    expect(out.sacrificeQuota).toBeCloseTo(0.9, 5);
  });

  it("clamp [0,1] em trust extremos", () => {
    const huge = computeTrustRatio(10.0);
    expect(huge.prazerQuota).toBe(0);
    expect(huge.sacrificeQuota).toBe(1);
    const neg = computeTrustRatio(-1.0);
    expect(neg.prazerQuota).toBeLessThanOrEqual(1);
    expect(neg.prazerQuota).toBeGreaterThanOrEqual(0);
  });

  it("prazer + sacrifice sempre soma 1", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1.0]) {
      const out = computeTrustRatio(t);
      expect(out.prazerQuota + out.sacrificeQuota).toBeCloseTo(1.0, 5);
    }
  });
});

describe("isItemAllowedUnderBudgetExhaustion — Gap 8", () => {
  it("item com sacrifice_amount ≤ threshold (7) permitido", () => {
    expect(isItemAllowedUnderBudgetExhaustion({ sacrifice_amount: 7 })).toBe(true);
    expect(isItemAllowedUnderBudgetExhaustion({ sacrifice_amount: 3 })).toBe(true);
    expect(isItemAllowedUnderBudgetExhaustion({ sacrifice_amount: 0 })).toBe(true);
  });

  it("item com sacrifice_amount > threshold bloqueado", () => {
    expect(isItemAllowedUnderBudgetExhaustion({ sacrifice_amount: 8 })).toBe(false);
    expect(isItemAllowedUnderBudgetExhaustion({ sacrifice_amount: 20 })).toBe(false);
  });

  it("undefined → usa BASE_EFFORT_DEFAULT (8) > threshold → bloqueado", () => {
    expect(isItemAllowedUnderBudgetExhaustion({})).toBe(false);
  });

  it("threshold constant é 7", () => {
    expect(BUDGET_EXHAUSTED_MAX_SACRIFICE).toBe(7);
  });
});

describe("extractPersonaSensitivity", () => {
  it("retorna sensitivity quando válida", () => {
    expect(extractPersonaSensitivity({ sensitivity: "sensory" })).toBe("sensory");
    expect(extractPersonaSensitivity({ sensitivity: "low" })).toBe("low");
    expect(extractPersonaSensitivity({ sensitivity: "high" })).toBe("high");
    expect(extractPersonaSensitivity({ sensitivity: "medium" })).toBe("medium");
  });

  it("default 'medium' quando ausente", () => {
    expect(extractPersonaSensitivity({})).toBe("medium");
    expect(extractPersonaSensitivity(undefined)).toBe("medium");
    expect(extractPersonaSensitivity(null)).toBe("medium");
  });

  it("default 'medium' quando valor inválido", () => {
    expect(extractPersonaSensitivity({ sensitivity: "extreme" })).toBe("medium");
    expect(extractPersonaSensitivity({ sensitivity: 42 })).toBe("medium");
  });
});
