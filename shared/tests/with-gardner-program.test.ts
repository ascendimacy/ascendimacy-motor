import { describe, it, expect } from "vitest";
import {
  composeInstructionAddition,
  isAssessmentReady,
  pairForWeek,
  shouldPauseProgram,
  nextPhase,
  PROGRAM_PHASES,
  PROGRAM_LENGTH_WEEKS,
  MIN_SESSIONS_FOR_ASSESSMENT,
} from "../src/mixins/with-gardner-program.js";
import type {
  GardnerAssessment,
  GardnerProgramState,
} from "../src/mixins/with-gardner-program.js";
import type { StatusMatrix } from "../src/status-matrix.js";

const assessment: GardnerAssessment = {
  top: ["linguistic", "logical_mathematical", "spatial", "interpersonal"],
  bottom: ["musical", "bodily_kinesthetic", "naturalist", "existential"],
  sessions_observed: 3,
};

describe("isAssessmentReady", () => {
  it("accepts assessment with ≥3 sessions + top/bottom populated", () => {
    expect(isAssessmentReady(assessment)).toBe(true);
  });
  it("rejects undefined", () => {
    expect(isAssessmentReady(undefined)).toBe(false);
  });
  it("rejects <3 sessions", () => {
    expect(isAssessmentReady({ ...assessment, sessions_observed: 2 })).toBe(false);
  });
  it("rejects empty top", () => {
    expect(isAssessmentReady({ ...assessment, top: [] })).toBe(false);
  });
  it("MIN_SESSIONS é 3", () => {
    expect(MIN_SESSIONS_FOR_ASSESSMENT).toBe(3);
  });
});

describe("pairForWeek — tabela §4.2", () => {
  it("semana 1 → Top#1 × Bottom#1", () => {
    const p = pairForWeek(1, assessment);
    expect(p).toEqual({
      strength: "linguistic",
      weakness: "musical",
      multi_channel: false,
    });
  });
  it("semana 2 → Top#2 × Bottom#2", () => {
    const p = pairForWeek(2, assessment);
    expect(p!.strength).toBe("logical_mathematical");
    expect(p!.weakness).toBe("bodily_kinesthetic");
  });
  it("semana 5 é arremate multi-canal", () => {
    const p = pairForWeek(5, assessment);
    expect(p!.multi_channel).toBe(true);
    expect(p!.strength).toBe("linguistic"); // volta pro Top#1
  });
  it("retorna null pra semana fora de 1-5", () => {
    expect(pairForWeek(0, assessment)).toBeNull();
    expect(pairForWeek(6, assessment)).toBeNull();
  });
  it("retorna null se assessment não pronto", () => {
    expect(pairForWeek(1, { ...assessment, sessions_observed: 1 })).toBeNull();
  });
  it("PROGRAM_LENGTH_WEEKS é 5", () => {
    expect(PROGRAM_LENGTH_WEEKS).toBe(5);
  });
});

describe("composeInstructionAddition — cada fase produz instrução distinta", () => {
  const base = {
    week_number: 1,
    day_in_week: 2,
    strength_channel: "linguistic" as const,
    weakness_channel: "musical" as const,
  };

  it("fase 1 exploration menciona off-screen + produção autêntica", () => {
    const out = composeInstructionAddition({ ...base, phase: "exploration_in_strength" });
    expect(out).toContain("Fase 1");
    expect(out).toContain("semana 1/5");
    expect(out).toContain("dia 2");
    expect(out).toMatch(/linguistic/);
    expect(out).toMatch(/musical/);
  });

  it("fase 2 translation menciona conversão via canal fraco", () => {
    const out = composeInstructionAddition({ ...base, phase: "translation_via_weakness" });
    expect(out).toContain("Fase 2");
    expect(out).toMatch(/converter|CONVERTER/i);
  });

  it("fase 3 presentation menciona audiência real", () => {
    const out = composeInstructionAddition({ ...base, phase: "presentation" });
    expect(out).toContain("Fase 3");
    expect(out).toMatch(/audiência|audiencia/i);
  });

  it("as 3 fases produzem outputs diferentes entre si", () => {
    const t1 = composeInstructionAddition({ ...base, phase: "exploration_in_strength" });
    const t2 = composeInstructionAddition({ ...base, phase: "translation_via_weakness" });
    const t3 = composeInstructionAddition({ ...base, phase: "presentation" });
    expect(t1).not.toBe(t2);
    expect(t2).not.toBe(t3);
    expect(t1).not.toBe(t3);
  });

  it("multi_channel=true muda o header para 'arremate multi-canal'", () => {
    const out = composeInstructionAddition({
      ...base,
      week_number: 5,
      phase: "exploration_in_strength",
      multi_channel: true,
    });
    expect(out).toMatch(/arremate multi-canal/);
  });

  it("PROGRAM_PHASES tem 3 fases na ordem correta", () => {
    expect(PROGRAM_PHASES).toEqual([
      "exploration_in_strength",
      "translation_via_weakness",
      "presentation",
    ]);
  });
});

describe("shouldPauseProgram — invariante emotional=brejo", () => {
  it("retorna paused=true quando emotional=brejo", () => {
    const m: StatusMatrix = { emotional: "brejo" };
    const r = shouldPauseProgram(m);
    expect(r.paused).toBe(true);
    expect(r.reason).toBe("emotional_brejo");
  });
  it("retorna paused=false com matrix saudável (baia/pasto)", () => {
    const m: StatusMatrix = { emotional: "baia", cognitive_math: "pasto" };
    expect(shouldPauseProgram(m).paused).toBe(false);
  });
  it("não pausa só por cognitive brejo (só emotional bloqueia)", () => {
    const m: StatusMatrix = { emotional: "baia", cognitive_math: "brejo" };
    expect(shouldPauseProgram(m).paused).toBe(false);
  });
  it("matrix vazia não pausa", () => {
    expect(shouldPauseProgram({}).paused).toBe(false);
  });
});

describe("nextPhase — transição de fases e semanas", () => {
  const initial: GardnerProgramState = {
    current_week: null,
    current_day: 1,
    current_phase: null,
    paused: false,
    phases_completed: 0,
    consecutive_missed_milestones: 0,
  };

  it("estado inicial pula pra week 1 phase 1", () => {
    const n = nextPhase(initial);
    expect(n.current_week).toBe(1);
    expect(n.current_phase).toBe("exploration_in_strength");
  });

  it("phase 1 → phase 2 (mesma semana)", () => {
    const s: GardnerProgramState = {
      ...initial,
      current_week: 1,
      current_phase: "exploration_in_strength",
    };
    const n = nextPhase(s);
    expect(n.current_week).toBe(1);
    expect(n.current_phase).toBe("translation_via_weakness");
    expect(n.phases_completed).toBe(1);
  });

  it("phase 3 → week+1 phase 1", () => {
    const s: GardnerProgramState = {
      ...initial,
      current_week: 2,
      current_phase: "presentation",
      phases_completed: 5,
    };
    const n = nextPhase(s);
    expect(n.current_week).toBe(3);
    expect(n.current_phase).toBe("exploration_in_strength");
  });

  it("week 5 phase 3 → programa completo (week/phase=null)", () => {
    const s: GardnerProgramState = {
      ...initial,
      current_week: 5,
      current_phase: "presentation",
      phases_completed: 14,
    };
    const n = nextPhase(s);
    expect(n.current_week).toBeNull();
    expect(n.current_phase).toBeNull();
    expect(n.phases_completed).toBe(15);
  });

  it("no-op quando pausado", () => {
    const s: GardnerProgramState = {
      ...initial,
      current_week: 1,
      current_phase: "exploration_in_strength",
      paused: true,
    };
    const n = nextPhase(s);
    expect(n.current_phase).toBe("exploration_in_strength");
  });
});
