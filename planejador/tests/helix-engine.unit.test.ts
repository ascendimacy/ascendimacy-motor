/**
 * Unit tests pra helix-engine (G-05, ops#1091).
 *
 * Cobre 4 sub-decisões ratified Jun 2026-05-16:
 *   1. Schema KidsHelixState — testado indiretamente via bootstrap/transitions.
 *   2. 50% overlap rotation + initial pair fallback SA+SOC.
 *   3. Queue/completed/deferred state transitions.
 *   4. Modo férias trigger compound + behavior.
 *
 * Edge cases:
 *   - All-dims-completed reshuffle
 *   - Initial pair fallback (no G-02 baseline)
 *   - 50% overlap continuity (cycle N→N+1→N+2)
 *   - Vacation pauses dayAdvance
 *   - Defer + substitute path
 */

import { describe, it, expect } from "vitest";
import {
  KIDS_HELIX_ACTIVE_DAYS,
  KIDS_HELIX_DEFAULT_FALLBACK_PAIR,
  KIDS_HELIX_TOTAL_DAYS,
  type CaselDimension,
  type KidsHelixState,
} from "@ascendimacy/shared";
import {
  bootstrapKidsHelixState,
  checkDeferTrigger,
  checkVacationTrigger,
  completeCycle,
  computeInitialPair,
  computeNextPair,
  cycleProgress,
  cycleStart,
  dayAdvance,
  deferDimension,
  enterVacation,
  exitVacation,
  resumeDimension,
} from "../src/strategist/helix-engine.js";

const NOW = "2026-05-16T12:00:00.000Z";
const LATER = "2026-05-17T12:00:00.000Z";

describe("computeInitialPair (sub-decisão 2 — initial pair selection)", () => {
  it("retorna fallback SA+SOC quando matrix vazia e signals ausentes", () => {
    // Sem matrix nem signals, default 2 (baia) pra todas; tie-break canônico
    // → SA primeiro. Sem signals → fallback partner SOC.
    const pair = computeInitialPair({});
    expect(pair[0]).toBe("SA");
    expect(pair[1]).toBe("SOC");
  });

  it("highest-need vence (dim em brejo prioriza)", () => {
    const pair = computeInitialPair({
      statusMatrix: { SM: "brejo", SA: "pasto", SOC: "baia" },
    });
    expect(pair[0]).toBe("SM"); // único brejo
    // Sem signals, partner é SOC (fallback porque SM != SOC).
    expect(pair[1]).toBe("SOC");
  });

  it("complementary via engagement signals (G-02 baseline)", () => {
    const pair = computeInitialPair({
      statusMatrix: { SM: "brejo" },
      engagementSignals: { REL: 0.9, DM: 0.4, SA: 0.7 },
    });
    expect(pair[0]).toBe("SM"); // highest need
    expect(pair[1]).toBe("REL"); // highest engagement entre não-SM
  });

  it("se highest-need é SOC, fallback partner vira SA", () => {
    const pair = computeInitialPair({
      statusMatrix: { SOC: "brejo" },
    });
    expect(pair[0]).toBe("SOC");
    expect(pair[1]).toBe("SA");
  });

  it("tie-break determinístico (ordem canônica SA, SM, SOC, REL, DM)", () => {
    // Todas baia → tie em score 2. Sort estável devolve SA primeiro.
    const pair = computeInitialPair({
      statusMatrix: { SA: "baia", SM: "baia", SOC: "baia", REL: "baia", DM: "baia" },
    });
    expect(pair[0]).toBe("SA");
  });
});

describe("bootstrapKidsHelixState (sub-decisão 1+2)", () => {
  it("cria state pra persona nova com par computado", () => {
    const state = bootstrapKidsHelixState({
      personaId: "ryo",
      nowIso: NOW,
    });
    expect(state.persona_id).toBe("ryo");
    expect(state.active_pair).toEqual(KIDS_HELIX_DEFAULT_FALLBACK_PAIR);
    expect(state.cycle_started_at).toBe(NOW);
    expect(state.current_day).toBe(0);
    expect(state.mode).toBe("active");
    expect(state.previous_pair).toBeNull();
    expect(state.cycles_completed).toBe(0);
    expect(state.queue).toEqual(["SM", "REL", "DM"]); // restantes
    expect(state.completed).toEqual([]);
    expect(state.deferred).toEqual([]);
    expect(state.vacation_trigger).toBeNull();
  });

  it("statusMatrix com brejo + signals → par computado correto", () => {
    const state = bootstrapKidsHelixState({
      personaId: "kei",
      nowIso: NOW,
      statusMatrix: { REL: "brejo" },
      engagementSignals: { SM: 0.95 },
    });
    expect(state.active_pair).toEqual(["REL", "SM"]);
    expect(state.queue).toEqual(["SA", "SOC", "DM"]);
  });
});

describe("cycleStart (sub-decisão 3)", () => {
  it("idempotente quando já em active + day=0", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const after = cycleStart({ state, nowIso: LATER });
    expect(after).toEqual(state);
  });

  it("força reset day/mode quando state em buffer", () => {
    const base = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const inBuffer: KidsHelixState = { ...base, mode: "buffer", current_day: 15 };
    const after = cycleStart({ state: inBuffer, nowIso: LATER });
    expect(after.mode).toBe("active");
    expect(after.current_day).toBe(0);
    expect(after.cycle_started_at).toBe(LATER);
  });
});

describe("dayAdvance (sub-decisão 3)", () => {
  it("avança de active 0→1 mantendo active", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const next = dayAdvance({ state, nowIso: LATER });
    expect(next.current_day).toBe(1);
    expect(next.mode).toBe("active");
  });

  it("transiciona pra buffer no dia 14", () => {
    const base = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const day13: KidsHelixState = { ...base, current_day: 13, mode: "active" };
    const next = dayAdvance({ state: day13, nowIso: LATER });
    expect(next.current_day).toBe(KIDS_HELIX_ACTIVE_DAYS);
    expect(next.mode).toBe("buffer");
  });

  it("cap no TOTAL_DAYS-1 (dia 17)", () => {
    const base = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const day17: KidsHelixState = { ...base, current_day: 17, mode: "buffer" };
    const next = dayAdvance({ state: day17, nowIso: LATER });
    expect(next.current_day).toBe(KIDS_HELIX_TOTAL_DAYS - 1);
    expect(next.mode).toBe("buffer");
  });

  it("vacation pausa advance (sub-decisão 4 behavior)", () => {
    const base = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const onVacation = enterVacation({
      state: base,
      trigger: "parental_request",
      nowIso: LATER,
    });
    const after = dayAdvance({ state: onVacation, nowIso: LATER });
    expect(after.current_day).toBe(0); // unchanged
    expect(after.mode).toBe("vacation");
  });
});

describe("computeNextPair (sub-decisão 2 — 50% overlap rotation)", () => {
  it("Y carry-over: [X,Y] → [Y,Z] onde Z é primeiro da queue", () => {
    const result = computeNextPair({
      currentPair: ["SA", "SOC"],
      queue: ["SM", "REL", "DM"],
      completed: [],
    });
    expect(result.pair).toEqual(["SOC", "SM"]);
    expect(result.queue).toEqual(["REL", "DM"]);
    expect(result.completed).toEqual(["SA"]);
  });

  it("preserva ordem queue (FIFO da queue)", () => {
    const result = computeNextPair({
      currentPair: ["SOC", "SM"],
      queue: ["REL", "DM"],
      completed: ["SA"],
    });
    expect(result.pair).toEqual(["SM", "REL"]);
    expect(result.queue).toEqual(["DM"]);
    expect(result.completed).toEqual(["SA", "SOC"]);
  });

  it("reshuffle quando completed atinge 5 dims", () => {
    // [DM, SA] completing → completed=[SM,SOC,REL,DM,SA]=5 → reshuffle.
    const result = computeNextPair({
      currentPair: ["DM", "SA"],
      queue: [],
      completed: ["SM", "SOC", "REL"],
      engagementSignals: { REL: 1.0, SM: 0.5 },
    });
    expect(result.completed).toEqual([]); // reset
    // New pair anchored em highest engagement: REL (1.0), SM (0.5).
    expect(result.pair).toEqual(["REL", "SM"]);
    expect(result.queue).toContain("SA");
    expect(result.queue).toContain("SOC");
    expect(result.queue).toContain("DM");
    expect(result.queue).toHaveLength(3);
  });

  it("reshuffle sem signals: ordem canônica tie-break", () => {
    const result = computeNextPair({
      currentPair: ["DM", "SA"],
      queue: [],
      completed: ["SM", "SOC", "REL"],
    });
    expect(result.pair).toEqual(["SA", "SM"]); // canonical SA,SM first
  });

  it("queue drenada (edge) usa fallback dim restante", () => {
    // Cenário extremo: queue vazia mas só 2 completed.
    const result = computeNextPair({
      currentPair: ["SA", "SOC"],
      queue: [],
      completed: ["SM"], // só 1 prior
    });
    // wouldComplete = [SM, SA] = 2 (< 5). Candidates da queue = []. Fallback
    // procura dim non-current, non-completed, non-queue → REL ou DM.
    // SOC carries; partner é primeiro fallback. Cand: SM (no completed), REL, DM.
    expect(result.pair[0]).toBe("SOC"); // Y carries
    expect(["REL", "DM"]).toContain(result.pair[1]);
  });
});

describe("completeCycle (sub-decisão 2+3 integration)", () => {
  it("incrementa cycles_completed + previous_pair = old active_pair", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const after = completeCycle({ state, nowIso: LATER });
    expect(after.cycles_completed).toBe(1);
    expect(after.previous_pair).toEqual(state.active_pair);
    expect(after.active_pair).toEqual(["SOC", "SM"]);
    expect(after.current_day).toBe(0);
    expect(after.mode).toBe("active");
    expect(after.cycle_started_at).toBe(LATER);
  });

  it("vacation: completeCycle é no-op (cycle congelado)", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const onVacation = enterVacation({
      state,
      trigger: "family_vacation_signal",
      nowIso: LATER,
    });
    const after = completeCycle({ state: onVacation, nowIso: LATER });
    expect(after).toEqual(onVacation);
  });

  it("50% overlap continuity: 3 ciclos consecutivos preservam carry-over", () => {
    let state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    // Cycle 1: [SA, SOC]
    expect(state.active_pair).toEqual(["SA", "SOC"]);
    state = completeCycle({ state, nowIso: NOW });
    // Cycle 2: [SOC, SM] — SOC carries
    expect(state.active_pair).toEqual(["SOC", "SM"]);
    state = completeCycle({ state, nowIso: NOW });
    // Cycle 3: [SM, REL] — SM carries
    expect(state.active_pair).toEqual(["SM", "REL"]);
    state = completeCycle({ state, nowIso: NOW });
    // Cycle 4: [REL, DM]
    expect(state.active_pair).toEqual(["REL", "DM"]);
    // Cycle 5: completing → all 5 hit → reshuffle.
    state = completeCycle({ state, nowIso: NOW });
    expect(state.completed).toEqual([]);
    expect(state.cycles_completed).toBe(4);
  });
});

describe("deferDimension (sub-decisão 3 — active→deferred)", () => {
  it("move dim do par pra deferred", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const after = deferDimension({
      state,
      dim: "SA",
      reason: "extended_brejo",
      nowIso: LATER,
    });
    expect(after.deferred).toContain("SA");
    expect(after.active_pair).toEqual(state.active_pair); // sem substitute, par inalterado
  });

  it("com substitute, troca dim do par", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const after = deferDimension({
      state,
      dim: "SA",
      reason: "vacation_triggered",
      nowIso: LATER,
      substitute: "REL",
    });
    expect(after.deferred).toContain("SA");
    expect(after.active_pair).toEqual(["REL", "SOC"]);
    expect(after.queue).not.toContain("REL");
  });

  it("no-op se dim não está no par ativo", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const after = deferDimension({
      state,
      dim: "DM", // não está no par (SA,SOC)
      reason: "parental_pause",
      nowIso: LATER,
    });
    expect(after).toEqual(state);
  });

  it("idempotente: dim já deferida não duplica", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const once = deferDimension({
      state,
      dim: "SA",
      reason: "extended_brejo",
      nowIso: LATER,
    });
    const twice = deferDimension({
      state: once,
      dim: "SA",
      reason: "extended_brejo",
      nowIso: LATER,
    });
    expect(twice.deferred).toEqual(["SA"]);
  });
});

describe("resumeDimension (sub-decisão 3 — deferred→queue)", () => {
  it("move dim de deferred pra queue", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const deferred = deferDimension({
      state,
      dim: "SA",
      reason: "extended_brejo",
      nowIso: LATER,
    });
    const resumed = resumeDimension({
      state: deferred,
      dim: "SA",
      reason: "recovery_confirmed",
      nowIso: LATER,
    });
    expect(resumed.deferred).not.toContain("SA");
    expect(resumed.queue).toContain("SA");
  });

  it("no-op se dim não está em deferred", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const after = resumeDimension({
      state,
      dim: "DM",
      reason: "parental_resume",
      nowIso: LATER,
    });
    expect(after).toEqual(state);
  });
});

describe("enterVacation / exitVacation (sub-decisão 4)", () => {
  it("enterVacation marca trigger + timestamp", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const after = enterVacation({
      state,
      trigger: "brejo_emotional_persistent",
      nowIso: LATER,
    });
    expect(after.mode).toBe("vacation");
    expect(after.vacation_trigger).toBe("brejo_emotional_persistent");
    expect(after.vacation_started_at).toBe(LATER);
  });

  it("exitVacation restaura mode active (current_day < 14)", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const onVacation = enterVacation({
      state,
      trigger: "parental_request",
      nowIso: LATER,
    });
    const after = exitVacation({ state: onVacation, nowIso: LATER });
    expect(after.mode).toBe("active");
    expect(after.vacation_trigger).toBeNull();
    expect(after.vacation_started_at).toBeNull();
  });

  it("exitVacation restaura buffer se current_day >= 14", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const buffered: KidsHelixState = { ...state, current_day: 16, mode: "active" };
    const onVacation = enterVacation({
      state: buffered,
      trigger: "parental_request",
      nowIso: LATER,
    });
    const after = exitVacation({ state: onVacation, nowIso: LATER });
    expect(after.mode).toBe("buffer");
  });

  it("enterVacation idempotente", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const first = enterVacation({
      state,
      trigger: "parental_request",
      nowIso: LATER,
    });
    const second = enterVacation({
      state: first,
      trigger: "family_vacation_signal", // different trigger
      nowIso: LATER,
    });
    expect(second).toEqual(first); // first trigger wins
  });
});

describe("checkVacationTrigger (sub-decisão 4 — compound trigger)", () => {
  const baseState = (overrides?: Partial<KidsHelixState>): KidsHelixState => ({
    ...bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW }),
    ...overrides,
  });

  it("parental_request triggers (single condition sufficient)", () => {
    const result = checkVacationTrigger({
      state: baseState(),
      parentalVacationStart: true,
    });
    expect(result.shouldEnterVacation).toBe(true);
    expect(result.trigger).toBe("parental_request");
  });

  it("brejo>5 dias triggers brejo_emotional_persistent", () => {
    const result = checkVacationTrigger({
      state: baseState(),
      consecutiveBrejoDaysEmotional: 6,
    });
    expect(result.shouldEnterVacation).toBe(true);
    expect(result.trigger).toBe("brejo_emotional_persistent");
  });

  it("brejo=5 não dispara (strict >)", () => {
    const result = checkVacationTrigger({
      state: baseState(),
      consecutiveBrejoDaysEmotional: 5,
    });
    expect(result.shouldEnterVacation).toBe(false);
  });

  it("sacrifice_exhaustion 3+ triggers", () => {
    const result = checkVacationTrigger({
      state: baseState(),
      consecutiveExhaustedSessions: 3,
    });
    expect(result.shouldEnterVacation).toBe(true);
    expect(result.trigger).toBe("sacrifice_exhaustion");
  });

  it("sacrifice 2 não dispara (precisa 3+)", () => {
    const result = checkVacationTrigger({
      state: baseState(),
      consecutiveExhaustedSessions: 2,
    });
    expect(result.shouldEnterVacation).toBe(false);
  });

  it("family_vacation_signal triggers", () => {
    const result = checkVacationTrigger({
      state: baseState(),
      familyVacationSignal: true,
    });
    expect(result.shouldEnterVacation).toBe(true);
    expect(result.trigger).toBe("family_vacation_signal");
  });

  it("priority: parental > family > brejo > sacrifice (multiple)", () => {
    const result = checkVacationTrigger({
      state: baseState(),
      parentalVacationStart: true,
      consecutiveBrejoDaysEmotional: 10,
      consecutiveExhaustedSessions: 5,
      familyVacationSignal: true,
    });
    expect(result.trigger).toBe("parental_request");
    expect(result.reasons).toHaveLength(4);
  });

  it("no-op se já em vacation", () => {
    const onVacation = enterVacation({
      state: baseState(),
      trigger: "parental_request",
      nowIso: LATER,
    });
    const result = checkVacationTrigger({
      state: onVacation,
      parentalVacationStart: true,
    });
    expect(result.shouldEnterVacation).toBe(false);
  });

  it("nenhuma condição → não dispara", () => {
    const result = checkVacationTrigger({ state: baseState() });
    expect(result.shouldEnterVacation).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});

describe("checkDeferTrigger (sub-decisão 3 — brejo>3d defer)", () => {
  it("brejo=4 (dim no par) → defer", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    expect(
      checkDeferTrigger({
        state,
        dim: "SA",
        consecutiveBrejoDays: 4,
      }),
    ).toBe(true);
  });

  it("brejo=3 → não defer (strict >)", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    expect(
      checkDeferTrigger({
        state,
        dim: "SA",
        consecutiveBrejoDays: 3,
      }),
    ).toBe(false);
  });

  it("dim fora do par ativo → não defer", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    expect(
      checkDeferTrigger({
        state,
        dim: "DM" satisfies CaselDimension,
        consecutiveBrejoDays: 10,
      }),
    ).toBe(false);
  });
});

describe("cycleProgress (G-07 downstream consumption)", () => {
  it("dia 0 → 0.0", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    expect(cycleProgress(state)).toBeCloseTo(0);
  });

  it("dia 9 → ~0.5 (G-07 50% trigger zone)", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const day9: KidsHelixState = { ...state, current_day: 9 };
    expect(cycleProgress(day9)).toBeCloseTo(9 / 18);
  });

  it("dia 17 (last) ≈ 1.0", () => {
    const state = bootstrapKidsHelixState({ personaId: "p1", nowIso: NOW });
    const day17: KidsHelixState = { ...state, current_day: 17, mode: "buffer" };
    expect(cycleProgress(day17)).toBeCloseTo(17 / 18);
  });
});
