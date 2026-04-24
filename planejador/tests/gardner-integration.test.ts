import { describe, it, expect } from "vitest";
import { buildGardnerInstruction, planTurn } from "../src/plan.js";
import type {
  GardnerAssessment,
  GardnerProgramState,
  PersonaDef,
  SessionState,
  StatusMatrix,
} from "@ascendimacy/shared";

process.env["USE_MOCK_LLM"] = "true";

const assessment: GardnerAssessment = {
  top: ["linguistic", "logical_mathematical", "spatial", "interpersonal"],
  bottom: ["musical", "bodily_kinesthetic", "naturalist", "existential"],
  sessions_observed: 3,
};

function makePersona(overrides: Partial<PersonaDef> = {}): PersonaDef {
  return {
    id: "ryo",
    name: "Ryo",
    age: 13,
    profile: { gardner_assessment: assessment },
    ...overrides,
  };
}

const baseProgram: GardnerProgramState = {
  current_week: 1,
  current_day: 1,
  current_phase: "exploration_in_strength",
  paused: false,
  phases_completed: 0,
  consecutive_missed_milestones: 0,
};

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "s1",
    trustLevel: 0.3,
    budgetRemaining: 100,
    turn: 0,
    eventLog: [],
    statusMatrix: { emotional: "baia" },
    ...overrides,
  };
}

const adquirente = { id: "jun", name: "Jun", defaults: {} };
const inventory = [
  { id: "kids.helix.session", title: "Helix", category: "kids", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
];

describe("buildGardnerInstruction — integração pura", () => {
  it("retorna active=false quando programa não iniciado", () => {
    const r = buildGardnerInstruction({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
    });
    expect(r.active).toBe(false);
    expect(r.text).toBe("");
  });

  it("retorna texto composto quando programa ativo + assessment pronto", () => {
    const r = buildGardnerInstruction({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState({ gardnerProgram: baseProgram }),
      incomingMessage: "oi",
    });
    expect(r.active).toBe(true);
    expect(r.text).toContain("semana 1/5");
    expect(r.text).toContain("Fase 1");
  });

  it("pausa automaticamente quando emotional=brejo (reusa canEmitChallenge)", () => {
    const brejoMatrix: StatusMatrix = { emotional: "brejo" };
    const r = buildGardnerInstruction({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState({ gardnerProgram: baseProgram, statusMatrix: brejoMatrix }),
      incomingMessage: "oi",
    });
    expect(r.active).toBe(false);
    expect(r.pauseReason).toBe("emotional_brejo");
  });

  it("não compõe quando assessment não pronto (min 3 sessões)", () => {
    const persona = makePersona({
      profile: {
        gardner_assessment: { ...assessment, sessions_observed: 2 },
      },
    });
    const r = buildGardnerInstruction({
      sessionId: "s1",
      persona,
      adquirente,
      inventory,
      state: makeState({ gardnerProgram: baseProgram }),
      incomingMessage: "oi",
    });
    expect(r.active).toBe(false);
    expect(r.pauseReason).toBe("assessment_not_ready");
  });

  it("não compõe quando programa já pausado", () => {
    const r = buildGardnerInstruction({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState({
        gardnerProgram: { ...baseProgram, paused: true, paused_reason: "child_request" },
      }),
      incomingMessage: "oi",
    });
    expect(r.active).toBe(false);
    expect(r.pauseReason).toBe("child_request");
  });

  it("texto difere entre 3 fases da mesma semana", () => {
    const make = (phase: GardnerProgramState["current_phase"]) =>
      buildGardnerInstruction({
        sessionId: "s1",
        persona: makePersona(),
        adquirente,
        inventory,
        state: makeState({ gardnerProgram: { ...baseProgram, current_phase: phase } }),
        incomingMessage: "oi",
      }).text;

    const t1 = make("exploration_in_strength");
    const t2 = make("translation_via_weakness");
    const t3 = make("presentation");
    expect(t1).not.toBe(t2);
    expect(t2).not.toBe(t3);
    expect(t1).not.toBe(t3);
  });
});

describe("planTurn — emite instruction_addition quando programa ativo", () => {
  it("instruction_addition não-vazio quando programa ativo + matrix ok", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState({ gardnerProgram: baseProgram }),
      incomingMessage: "oi",
    });
    expect(out.instruction_addition).toBeTruthy();
    expect(out.instruction_addition).toContain("semana");
  });

  it("instruction_addition vazia quando programa pausado por brejo", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState({
        gardnerProgram: baseProgram,
        statusMatrix: { emotional: "brejo" },
      }),
      incomingMessage: "oi",
    });
    expect(out.instruction_addition).toBe("");
    expect(out.contextHints["gardner_pause_reason"]).toBe("emotional_brejo");
  });

  it("contextHints.gardner_program_active reflete estado real", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState({ gardnerProgram: baseProgram }),
      incomingMessage: "oi",
    });
    expect(out.contextHints["gardner_program_active"]).toBe(true);
    expect(out.contextHints["gardner_current_week"]).toBe(1);
  });

  it("instruction_addition vazia quando programa não iniciado", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
    });
    expect(out.instruction_addition).toBe("");
  });
});
