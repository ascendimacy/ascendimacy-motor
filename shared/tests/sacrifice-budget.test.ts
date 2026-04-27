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
