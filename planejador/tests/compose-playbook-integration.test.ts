import { describe, it, expect } from "vitest";
import { planTurn } from "../src/plan.js";
import {
  EmergentPlaybookSchema,
  type PersonaDef,
  type SessionState,
  type SubjectInventory,
} from "@ascendimacy/shared";

process.env["USE_MOCK_LLM"] = "true";

function makePersona(overrides: Partial<PersonaDef> = {}): PersonaDef {
  return {
    id: "kei",
    name: "Kei",
    age: 11,
    profile: {},
    ...overrides,
  };
}

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "s1",
    trustLevel: 0.4,
    budgetRemaining: 100,
    turn: 2,
    eventLog: [],
    statusMatrix: { emotional: "baia" },
    ...overrides,
  };
}

const adquirente = { id: "jun", name: "Jun", defaults: {} };
const inventory = [
  {
    id: "kids.helix.session",
    title: "Helix",
    category: "kids",
    estimatedSacrifice: 1,
    estimatedConfidenceGain: 4,
  },
];

describe("planTurn — compose_playbook integration (fatia 4)", () => {
  it("default sem flag → move_type NÃO é compose_playbook", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
    });
    expect(out.contextHints["tutorial"]).toBeTruthy();
    const tutorial = out.contextHints["tutorial"] as { move_type: string };
    expect(tutorial.move_type).not.toBe("compose_playbook");
  });

  it("flag true → move_type=compose_playbook", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
      contextHints: { compose_playbook_request: true },
    });
    const tutorial = out.contextHints["tutorial"] as { move_type: string; teaching_goal: string };
    expect(tutorial.move_type).toBe("compose_playbook");
    expect(tutorial.teaching_goal.toLowerCase()).toContain("inventário");
  });

  it("flag true sem inventory → inventory_probe_options preenchido (5 questões)", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
      contextHints: { compose_playbook_request: true },
    });
    const probe = out.contextHints["inventory_probe_options"] as Array<{ kind: string }>;
    expect(Array.isArray(probe)).toBe(true);
    expect(probe.length).toBe(5);
  });

  it("flag true com partial inventory pula dimensões cobertas", async () => {
    const partial: Partial<SubjectInventory> = {
      available_time_minutes: 90,
      available_materials: ["ovos", "farinha"],
    };
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
      contextHints: {
        compose_playbook_request: true,
        subject_inventory: partial,
      },
    });
    const probe = out.contextHints["inventory_probe_options"] as Array<{ kind: string }>;
    const kinds = probe.map((q) => q.kind);
    expect(kinds).not.toContain("time_window");
    expect(kinds).not.toContain("materials_around");
    expect(probe.length).toBe(3);
  });

  it("flag true → emergent_playbook preenchido + zod válido", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
      contextHints: { compose_playbook_request: true },
    });
    const playbook = out.contextHints["emergent_playbook"];
    expect(playbook).toBeTruthy();
    const parsed = EmergentPlaybookSchema.safeParse(playbook);
    expect(parsed.success).toBe(true);
  });

  it("flag true sobrepõe outros triggers (exit signal não vence)", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "tchau",
      contextHints: {
        compose_playbook_request: true,
        extracted_signals: ["exit_marker_explicit"],
      },
    });
    const tutorial = out.contextHints["tutorial"] as { move_type: string };
    expect(tutorial.move_type).toBe("compose_playbook");
  });

  it("advance_policy = can_move_on (configurado em §switch)", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
      contextHints: { compose_playbook_request: true },
    });
    const tutorial = out.contextHints["tutorial"] as { advance_policy?: string };
    expect(tutorial.advance_policy).toBe("can_move_on");
  });

  it("flag false (não truthy literal) NÃO dispara", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
      contextHints: { compose_playbook_request: false },
    });
    const tutorial = out.contextHints["tutorial"] as { move_type: string };
    expect(tutorial.move_type).not.toBe("compose_playbook");
    expect(out.contextHints["emergent_playbook"]).toBeUndefined();
  });

  it("nome do sujeito flui pro playbook_id", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona({ id: "ryo", name: "Ryo", age: 13 }),
      adquirente,
      inventory,
      state: makeState(),
      incomingMessage: "oi",
      contextHints: { compose_playbook_request: true },
    });
    const playbook = out.contextHints["emergent_playbook"] as { playbook_id: string };
    expect(playbook.playbook_id).toContain("Ryo");
  });
});
