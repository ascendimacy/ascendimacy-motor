import { describe, it, expect } from "vitest";
import { planTurn } from "../src/plan.js";
import { buildPool } from "../src/pool-builder.js";
import type {
  PersonaDef,
  SessionState,
  StatusMatrix,
  ContentItem,
} from "@ascendimacy/shared";

process.env["USE_MOCK_LLM"] = "true";

const adquirente = { id: "jun", name: "Jun", defaults: {} };
const inventory = [
  { id: "kids.helix.session", title: "Helix", category: "kids", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
];

function makeHook(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "h1",
    type: "curiosity_hook",
    domain: "biology",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 8,
    verified: true,
    base_score: 7,
    fact: "f",
    bridge: "b",
    quest: "q",
    sacrifice_type: "reflect",
    ...overrides,
  } as ContentItem;
}

const ryo: PersonaDef = { id: "ryo", name: "Ryo", age: 13, profile: {} };

const baseState: SessionState = {
  sessionId: "joint-s1",
  trustLevel: 0.5,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
  statusMatrix: { emotional: "baia" },
};

describe("buildPool — joint filtra non-group-compatible (Bloco 6b)", () => {
  it("sessionMode='joint' remove items sem group_compatible=true", () => {
    const pool = [
      makeHook({ id: "solo_only", group_compatible: false }),
      makeHook({ id: "dyad_ok", group_compatible: true }),
      makeHook({ id: "no_flag" }),
    ];
    const built = buildPool(pool, { age: 10, sessionMode: "joint" });
    expect(built.map((i) => i.id)).toEqual(["dyad_ok"]);
  });

  it("sessionMode='1v1' não filtra (solo inclui todos)", () => {
    const pool = [
      makeHook({ id: "solo_only", group_compatible: false }),
      makeHook({ id: "dyad_ok", group_compatible: true }),
    ];
    const built = buildPool(pool, { age: 10, sessionMode: "1v1" });
    expect(built.map((i) => i.id).sort()).toEqual(["dyad_ok", "solo_only"]);
  });
});

describe("planTurn — joint mode contextHints", () => {
  it("sessionMode='joint' emite hint session_mode + joint_partner_name", async () => {
    const out = await planTurn({
      sessionId: "joint-s1",
      persona: ryo,
      adquirente,
      inventory,
      state: {
        ...baseState,
        sessionMode: "joint",
        jointPartnerChildId: "kei",
        jointPartnerName: "Kei",
      },
      incomingMessage: "oi",
    });
    expect(out.contextHints["session_mode"]).toBe("joint");
    expect(out.contextHints["joint_partner_name"]).toBe("Kei");
    expect(out.contextHints["joint_partner_child_id"]).toBe("kei");
  });

  it("sessionMode='solo' (default) não emite session_mode", async () => {
    const out = await planTurn({
      sessionId: "solo-s1",
      persona: ryo,
      adquirente,
      inventory,
      state: baseState,
      incomingMessage: "oi",
    });
    expect(out.contextHints["session_mode"]).toBeUndefined();
  });
});

describe("planTurn — brejo UNILATERAL do parceiro pausa (Bloco 6e)", () => {
  it("partnerStatusMatrix.emotional='brejo' → joint_unilateral_brejo + pause_reason", async () => {
    const partnerBrejo: StatusMatrix = { emotional: "brejo" };
    const out = await planTurn({
      sessionId: "joint-s1",
      persona: ryo,
      adquirente,
      inventory,
      state: {
        ...baseState,
        sessionMode: "joint",
        jointPartnerChildId: "kei",
        jointPartnerName: "Kei",
        partnerStatusMatrix: partnerBrejo,
      },
      incomingMessage: "oi",
    });
    expect(out.contextHints["joint_unilateral_brejo"]).toBe(true);
    expect(out.contextHints["joint_pause_reason"]).toContain("partner_");
  });

  it("ambos saudáveis → sem joint_unilateral_brejo", async () => {
    const out = await planTurn({
      sessionId: "joint-s1",
      persona: ryo,
      adquirente,
      inventory,
      state: {
        ...baseState,
        sessionMode: "joint",
        jointPartnerChildId: "kei",
        jointPartnerName: "Kei",
        partnerStatusMatrix: { emotional: "baia", cognitive_math: "pasto" },
      },
      incomingMessage: "oi",
    });
    expect(out.contextHints["joint_unilateral_brejo"]).toBeUndefined();
    expect(out.contextHints["partner_status_gates"]).toBeDefined();
  });
});
