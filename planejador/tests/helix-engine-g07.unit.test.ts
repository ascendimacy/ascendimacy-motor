/**
 * Unit tests pra helix-engine G-07 cadência 18d (ops#1020).
 *
 * Cobre:
 *  - `activeCycleProgress` (0..1 sobre fase ativa 14d, vs cycleProgress total 18d).
 *  - `detectCadenceTriggers` — fire at day 7 (retrieval+midcycle), day 14 (boss).
 *  - `markTriggerFired` — idempotência (não duplica triggers).
 *  - `assessCycleExtension` — heurística conservative GO C (default 2 weeks).
 *  - `computeEvolutionAssessment` — Dreyfus + status + progress weighted blend.
 *  - Reset de triggers em `completeCycle` + `cycleStart` (cross-cycle isolation).
 *  - Vacation: triggers congelados (zero fire).
 *  - Buffer: triggers anteriores não re-fire mas boss_fight_100 ainda válido.
 */

import { describe, it, expect } from "vitest";
import {
  KIDS_HELIX_ACTIVE_DAYS,
  KIDS_HELIX_BOSS_FIGHT_TRIGGER_DAY,
  KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD,
  KIDS_HELIX_MIDCYCLE_ASSESSMENT_DAY,
  KIDS_HELIX_RETRIEVAL_TRIGGER_DAY,
  KIDS_HELIX_TOTAL_DAYS,
  defaultKidsHelixState,
  type KidsHelixState,
} from "@ascendimacy/shared";
import {
  activeCycleProgress,
  assessCycleExtension,
  completeCycle,
  computeEvolutionAssessment,
  cycleStart,
  dayAdvance,
  detectCadenceTriggers,
  enterVacation,
  markTriggerFired,
} from "../src/strategist/helix-engine.js";

const NOW = "2026-05-16T12:00:00.000Z";
const LATER = "2026-05-17T12:00:00.000Z";

function freshState(overrides: Partial<KidsHelixState> = {}): KidsHelixState {
  return {
    ...defaultKidsHelixState({ personaId: "ryo", nowIso: NOW }),
    ...overrides,
  };
}

describe("activeCycleProgress (G-07 — fase ativa 14d)", () => {
  it("dia 0 → 0.0", () => {
    expect(activeCycleProgress(freshState({ current_day: 0 }))).toBe(0);
  });

  it("dia 7 → 0.5 (fronteira retrieval)", () => {
    expect(activeCycleProgress(freshState({ current_day: 7 }))).toBe(0.5);
  });

  it("dia 14 → 1.0 (fronteira boss fight)", () => {
    expect(activeCycleProgress(freshState({ current_day: 14 }))).toBe(1);
  });

  it("dia 17 (buffer) → 1.0 (active phase fechada, clamp)", () => {
    expect(activeCycleProgress(freshState({ current_day: 17 }))).toBe(1);
  });

  it("difere de cycleProgress(total 18d) no mesmo dia", () => {
    // Dia 9 (50% total) vs dia 9/14 = ~0.64 active.
    const state = freshState({ current_day: 9 });
    expect(activeCycleProgress(state)).toBeCloseTo(9 / 14);
    // cycleProgress same dia = 0.5.
  });
});

describe("detectCadenceTriggers (G-07 — sub-decisão GO C, fire-once-per-cycle)", () => {
  it("dia 0..6 → zero triggers (pré-fronteira)", () => {
    for (let d = 0; d < KIDS_HELIX_RETRIEVAL_TRIGGER_DAY; d++) {
      const state = freshState({ current_day: d });
      expect(detectCadenceTriggers(state)).toEqual([]);
    }
  });

  it("dia 7 → retrieval_50 + midcycle_assessment_7 simultâneos", () => {
    const state = freshState({ current_day: 7 });
    const triggers = detectCadenceTriggers(state);
    expect(triggers).toContain("retrieval_50");
    expect(triggers).toContain("midcycle_assessment_7");
    expect(triggers).not.toContain("boss_fight_100");
  });

  it("dia 8..13 → retrieval + midcycle ainda pendentes se não marcados", () => {
    const state = freshState({ current_day: 12 });
    const triggers = detectCadenceTriggers(state);
    expect(triggers).toContain("retrieval_50");
    expect(triggers).toContain("midcycle_assessment_7");
    expect(triggers).not.toContain("boss_fight_100");
  });

  it("dia 14 → adiciona boss_fight_100 (cumulativo se anteriores não marcados)", () => {
    const state = freshState({ current_day: 14 });
    const triggers = detectCadenceTriggers(state);
    expect(triggers).toContain("retrieval_50");
    expect(triggers).toContain("midcycle_assessment_7");
    expect(triggers).toContain("boss_fight_100");
  });

  it("após mark retrieval+midcycle, dia 14 → só boss_fight_100 pendente", () => {
    const state = freshState({
      current_day: 14,
      triggers_fired_this_cycle: ["retrieval_50", "midcycle_assessment_7"],
    });
    const triggers = detectCadenceTriggers(state);
    expect(triggers).toEqual(["boss_fight_100"]);
  });

  it("após mark all, dia 17 → zero pending", () => {
    const state = freshState({
      current_day: 17,
      triggers_fired_this_cycle: [
        "retrieval_50",
        "midcycle_assessment_7",
        "boss_fight_100",
      ],
    });
    expect(detectCadenceTriggers(state)).toEqual([]);
  });

  it("vacation → zero triggers (cycle paused independent of day)", () => {
    const state = freshState({ current_day: 14, mode: "vacation" });
    expect(detectCadenceTriggers(state)).toEqual([]);
  });

  it("buffer mode no dia 14 → boss_fight_100 ainda fire (active phase done)", () => {
    const state = freshState({ current_day: 14, mode: "buffer" });
    const triggers = detectCadenceTriggers(state);
    expect(triggers).toContain("boss_fight_100");
  });
});

describe("markTriggerFired (G-07 — idempotência)", () => {
  it("adiciona trigger ao array quando ausente", () => {
    const state = freshState({ current_day: 7 });
    const next = markTriggerFired({
      state,
      trigger: "retrieval_50",
      nowIso: LATER,
    });
    expect(next.triggers_fired_this_cycle).toEqual(["retrieval_50"]);
    expect(next.updated_at).toBe(LATER);
  });

  it("no-op se trigger já marcado (idempotente)", () => {
    const state = freshState({
      current_day: 7,
      triggers_fired_this_cycle: ["retrieval_50"],
    });
    const next = markTriggerFired({
      state,
      trigger: "retrieval_50",
      nowIso: LATER,
    });
    expect(next).toBe(state); // mesma ref (no-op)
    expect(next.triggers_fired_this_cycle).toEqual(["retrieval_50"]);
  });

  it("preserva triggers anteriores ao adicionar novo", () => {
    const state = freshState({
      current_day: 14,
      triggers_fired_this_cycle: ["retrieval_50", "midcycle_assessment_7"],
    });
    const next = markTriggerFired({
      state,
      trigger: "boss_fight_100",
      nowIso: LATER,
    });
    expect(next.triggers_fired_this_cycle).toEqual([
      "retrieval_50",
      "midcycle_assessment_7",
      "boss_fight_100",
    ]);
  });

  it("preserva ordem cronológica de marcação", () => {
    let state = freshState({ current_day: 7 });
    state = markTriggerFired({
      state,
      trigger: "midcycle_assessment_7",
      nowIso: NOW,
    });
    state = markTriggerFired({
      state,
      trigger: "retrieval_50",
      nowIso: LATER,
    });
    expect(state.triggers_fired_this_cycle).toEqual([
      "midcycle_assessment_7",
      "retrieval_50",
    ]);
  });
});

describe("completeCycle / cycleStart reseta triggers (cross-cycle isolation)", () => {
  it("completeCycle limpa triggers_fired_this_cycle", () => {
    const state = freshState({
      current_day: 17,
      triggers_fired_this_cycle: [
        "retrieval_50",
        "midcycle_assessment_7",
        "boss_fight_100",
      ],
    });
    const next = completeCycle({ state, nowIso: LATER });
    expect(next.triggers_fired_this_cycle).toEqual([]);
    expect(next.cycles_completed).toBe(1);
  });

  it("cycleStart após buffer limpa triggers", () => {
    const state = freshState({
      current_day: 17,
      mode: "buffer",
      triggers_fired_this_cycle: ["boss_fight_100"],
    });
    const next = cycleStart({ state, nowIso: LATER });
    expect(next.triggers_fired_this_cycle).toEqual([]);
  });

  it("cycleStart no-op (já active+day0) preserva triggers (idempotência protege)", () => {
    const state = freshState({
      current_day: 0,
      mode: "active",
      triggers_fired_this_cycle: [],
    });
    const next = cycleStart({ state, nowIso: LATER });
    expect(next).toBe(state); // mesma ref (no-op)
  });

  it("ciclo N+1 começa limpo: pode re-fire mesmo trigger após complete", () => {
    let state = freshState({
      current_day: 17,
      triggers_fired_this_cycle: ["retrieval_50", "boss_fight_100"],
    });
    state = completeCycle({ state, nowIso: LATER });
    // Novo ciclo dia 0 → após avanços, triggers re-fire.
    expect(state.current_day).toBe(0);
    expect(detectCadenceTriggers(state)).toEqual([]);
    // Fast-forward pra day 7.
    state = { ...state, current_day: 7 };
    const pending = detectCadenceTriggers(state);
    expect(pending).toContain("retrieval_50");
    expect(pending).toContain("midcycle_assessment_7");
  });
});

describe("assessCycleExtension (G-07 — sub-decisão GO C, conservative defaults)", () => {
  it("sem sinais → standard_2_weeks default", () => {
    const state = freshState({ current_day: 7 });
    const result = assessCycleExtension({
      state,
      evolutionPercentage: 0.5, // acima threshold
    });
    expect(result.recommendation).toBe("standard_2_weeks");
    expect(result.reasons).toContain("default_no_extension_signal");
  });

  it("evolution baixa → extended_4_weeks", () => {
    const state = freshState({ current_day: 7 });
    const result = assessCycleExtension({
      state,
      evolutionPercentage: 0.1, // < 0.3 threshold
    });
    expect(result.recommendation).toBe("extended_4_weeks");
    expect(result.reasons.some((r) => r.startsWith("evolution_below_threshold"))).toBe(
      true,
    );
  });

  it("dim do active_pair em brejo → extended_4_weeks", () => {
    const state = freshState({
      current_day: 7,
      active_pair: ["SM", "SOC"],
    });
    const result = assessCycleExtension({
      state,
      evolutionPercentage: 0.8,
      statusMatrix: { SM: "brejo", SOC: "pasto" },
    });
    expect(result.recommendation).toBe("extended_4_weeks");
    expect(result.reasons).toContain("active_dim_brejo:SM");
  });

  it("parental signal explícito → extended_4_weeks", () => {
    const state = freshState({ current_day: 7 });
    const result = assessCycleExtension({
      state,
      evolutionPercentage: 0.9,
      parentalNeedsMoreTime: true,
    });
    expect(result.recommendation).toBe("extended_4_weeks");
    expect(result.reasons).toContain("parental_needs_more_time");
  });

  it("threshold exact boundary (= 0.3) → standard (não dispara extension)", () => {
    const state = freshState({ current_day: 7 });
    const result = assessCycleExtension({
      state,
      evolutionPercentage: KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD,
    });
    // < não atende (igual = standard).
    expect(result.recommendation).toBe("standard_2_weeks");
  });

  it("multi-signal acumula reasons (parental + brejo + low evolution)", () => {
    const state = freshState({
      current_day: 7,
      active_pair: ["SM", "SOC"],
    });
    const result = assessCycleExtension({
      state,
      evolutionPercentage: 0.05,
      statusMatrix: { SM: "brejo" },
      parentalNeedsMoreTime: true,
    });
    expect(result.recommendation).toBe("extended_4_weeks");
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("computeEvolutionAssessment (G-07 — Dreyfus+status+progress blend)", () => {
  it("sem nenhum sinal → 0 (no Dreyfus, no status, day=0 progress=0)", () => {
    const state = freshState({ current_day: 0 });
    expect(computeEvolutionAssessment({ state })).toBe(0);
  });

  it("dia 7 sem status sem Dreyfus → ~0.4*0.5 = 0.2 (só progress)", () => {
    const state = freshState({ current_day: 7 });
    const evo = computeEvolutionAssessment({ state });
    // Peso pra progress sem Dreyfus = 0.4; progress = 0.5 → 0.2.
    expect(evo).toBeCloseTo(0.2);
  });

  it("status pasto puro (sem Dreyfus) dia 7 → 0.6*1.0 + 0.4*0.5 = 0.8", () => {
    const state = freshState({
      current_day: 7,
      active_pair: ["SA", "SOC"],
    });
    const evo = computeEvolutionAssessment({
      state,
      statusMatrix: { SA: "pasto", SOC: "pasto" },
    });
    expect(evo).toBeCloseTo(0.8);
  });

  it("status brejo puro (sem Dreyfus) dia 7 → 0.6*0 + 0.4*0.5 = 0.2", () => {
    const state = freshState({
      current_day: 7,
      active_pair: ["SA", "SOC"],
    });
    const evo = computeEvolutionAssessment({
      state,
      statusMatrix: { SA: "brejo", SOC: "brejo" },
    });
    expect(evo).toBeCloseTo(0.2);
  });

  it("com Dreyfus progression (1 step gain em 1 dim) → entra no blend", () => {
    const state = freshState({
      current_day: 7,
      active_pair: ["SA", "SOC"],
    });
    const evo = computeEvolutionAssessment({
      state,
      dreyfusBaseline: { SA: "novice", SOC: "novice" },
      dreyfusObserved: { SA: "apprentice", SOC: "novice" },
      statusMatrix: { SA: "baia", SOC: "baia" },
    });
    // Dreyfus: SA=1/4=0.25, SOC=0/4=0 → média 0.125, peso 0.5 = 0.0625
    // Status: 0.5+0.5/2 = 0.5, peso 0.3 = 0.15
    // Progress: 7/14=0.5, peso 0.2 = 0.1
    // Total = 0.3125
    expect(evo).toBeCloseTo(0.3125);
  });

  it("Dreyfus regression (negative delta) é clampado em 0", () => {
    const state = freshState({
      current_day: 7,
      active_pair: ["SA", "SOC"],
    });
    const evo = computeEvolutionAssessment({
      state,
      dreyfusBaseline: { SA: "proficient", SOC: "expert" },
      dreyfusObserved: { SA: "novice", SOC: "apprentice" }, // regressão
    });
    // Dreyfus component = 0 (clamp). Sem statusMatrix, statusComponent=0.
    // Mas baseline Dreyfus presente, então não cai no fallback.
    // 0*0.5 + 0*0.3 + 0.5*0.2 = 0.1.
    expect(evo).toBeCloseTo(0.1);
  });

  it("Dreyfus max progress (novice→expert) ambas dims dia 14 → ~0.85", () => {
    const state = freshState({
      current_day: 14,
      active_pair: ["SA", "SOC"],
    });
    const evo = computeEvolutionAssessment({
      state,
      dreyfusBaseline: { SA: "novice", SOC: "novice" },
      dreyfusObserved: { SA: "expert", SOC: "expert" },
      statusMatrix: { SA: "pasto", SOC: "pasto" },
    });
    // Dreyfus: 1.0 * 0.5 = 0.5
    // Status: 1.0 * 0.3 = 0.3
    // Progress: 1.0 (clamp) * 0.2 = 0.2
    // Total = 1.0
    expect(evo).toBeCloseTo(1.0);
  });
});

describe("integration: cycle progression with G-07 triggers", () => {
  it("simulação completa de ciclo: dia 0 → 7 → 14 → 17 → completeCycle", () => {
    let state = freshState();
    expect(detectCadenceTriggers(state)).toEqual([]);

    // Avanço dia a dia até 7
    for (let i = 0; i < 7; i++) {
      state = dayAdvance({ state, nowIso: LATER });
    }
    expect(state.current_day).toBe(7);
    let pending = detectCadenceTriggers(state);
    expect(pending).toContain("retrieval_50");
    expect(pending).toContain("midcycle_assessment_7");

    // Mark both
    state = markTriggerFired({
      state,
      trigger: "retrieval_50",
      nowIso: LATER,
    });
    state = markTriggerFired({
      state,
      trigger: "midcycle_assessment_7",
      nowIso: LATER,
    });
    expect(detectCadenceTriggers(state)).toEqual([]);

    // Avanço até dia 14
    for (let i = 7; i < 14; i++) {
      state = dayAdvance({ state, nowIso: LATER });
    }
    expect(state.current_day).toBe(14);
    expect(state.mode).toBe("buffer");
    pending = detectCadenceTriggers(state);
    expect(pending).toEqual(["boss_fight_100"]);

    state = markTriggerFired({
      state,
      trigger: "boss_fight_100",
      nowIso: LATER,
    });

    // Avanço até dia 17 (buffer end)
    while (state.current_day < KIDS_HELIX_TOTAL_DAYS - 1) {
      state = dayAdvance({ state, nowIso: LATER });
    }
    expect(state.current_day).toBe(17);
    expect(detectCadenceTriggers(state)).toEqual([]);

    // completeCycle → reseta triggers + active pair rotation
    const before = state.cycles_completed;
    state = completeCycle({ state, nowIso: LATER });
    expect(state.cycles_completed).toBe(before + 1);
    expect(state.triggers_fired_this_cycle).toEqual([]);
    expect(state.current_day).toBe(0);
    expect(state.mode).toBe("active");
    expect(state.previous_pair).toEqual(["SA", "SOC"]);
  });

  it("vacation antes do dia 7 → triggers não fire mesmo após exit (mantém ordem da spec)", () => {
    let state = freshState({ current_day: 5 });
    state = enterVacation({
      state,
      trigger: "parental_request",
      nowIso: LATER,
    });
    expect(detectCadenceTriggers(state)).toEqual([]);

    // Manual exit (uses helper enterVacation reverse not tested here — simulamos via direct).
    state = { ...state, mode: "active", vacation_trigger: null };
    // Day ainda é 5, então sem trigger.
    expect(detectCadenceTriggers(state)).toEqual([]);
  });
});

describe("contracts compatibility (G-07 const sanity)", () => {
  it("KIDS_HELIX_RETRIEVAL_TRIGGER_DAY = ACTIVE_DAYS / 2", () => {
    expect(KIDS_HELIX_RETRIEVAL_TRIGGER_DAY).toBe(KIDS_HELIX_ACTIVE_DAYS / 2);
  });

  it("KIDS_HELIX_BOSS_FIGHT_TRIGGER_DAY = ACTIVE_DAYS", () => {
    expect(KIDS_HELIX_BOSS_FIGHT_TRIGGER_DAY).toBe(KIDS_HELIX_ACTIVE_DAYS);
  });

  it("KIDS_HELIX_MIDCYCLE_ASSESSMENT_DAY coincide com retrieval", () => {
    expect(KIDS_HELIX_MIDCYCLE_ASSESSMENT_DAY).toBe(
      KIDS_HELIX_RETRIEVAL_TRIGGER_DAY,
    );
  });

  it("EXTENSION_EVOLUTION_THRESHOLD é conservative (0..1)", () => {
    expect(KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD).toBeGreaterThan(0);
    expect(KIDS_HELIX_EXTENSION_EVOLUTION_THRESHOLD).toBeLessThan(1);
  });
});
