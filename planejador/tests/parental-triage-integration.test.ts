import { describe, it, expect } from "vitest";
import { planTurn, extractParentalProfile } from "../src/plan.js";
import type {
  ParentalProfile,
  PersonaDef,
  SessionState,
} from "@ascendimacy/shared";

process.env["USE_MOCK_LLM"] = "true";

const yujiProfile: ParentalProfile = {
  id: "yuji",
  role: "primary",
  decision_profile: "consultative_risk_averse",
  family_values: {
    principles: ["esforço>resultado"],
  },
  forbidden_zones: [
    { topic: "politic", reason: "divisivo" },
    { topic: "religio", reason: "respeito" },
  ],
  budget_constraints: { screen_time_daily_max_minutes: 90 },
  parental_availability: {
    scale_tolerance: { micro: "yes", pequeno: "yes", medio: "yes" },
    ready_for_dyad_sessions: true,
  },
};

function makePersona(overrides: Partial<PersonaDef> = {}): PersonaDef {
  return {
    id: "ryo",
    name: "Ryo",
    age: 13,
    profile: {},
    ...overrides,
  };
}

const baseState: SessionState = {
  sessionId: "s1",
  trustLevel: 0.3,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
  statusMatrix: { emotional: "baia" },
};

const adquirente = { id: "jun", name: "Jun", defaults: {} };
const inventory = [
  { id: "kids.helix.session", title: "Helix", category: "kids", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
];

describe("extractParentalProfile", () => {
  it("extracts when persona.profile.parental_profile present", () => {
    const persona = makePersona({ profile: { parental_profile: yujiProfile } });
    expect(extractParentalProfile(persona)?.id).toBe("yuji");
  });

  it("undefined when ausente", () => {
    expect(extractParentalProfile(makePersona())).toBeUndefined();
  });
});

describe("planTurn — triagem parental integrada", () => {
  it("contextHints sem parental_triage_mode quando parental_profile ausente", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona(),
      adquirente,
      inventory,
      state: baseState,
      incomingMessage: "oi",
    });
    expect(out.contextHints["parental_triage_mode"]).toBeUndefined();
  });

  it("adiciona contextHints.parental_triage_mode='rule_based' quando parental_profile presente e USE_MOCK_LLM", async () => {
    const out = await planTurn({
      sessionId: "s1",
      persona: makePersona({ profile: { parental_profile: yujiProfile } }),
      adquirente,
      inventory,
      state: baseState,
      incomingMessage: "oi",
    });
    expect(out.contextHints["parental_triage_mode"]).toBe("rule_based");
  });

  it("contentPool filtrado quando forbidden_zone bate em top hook (via domain boost)", async () => {
    const strictProfile: ParentalProfile = {
      ...yujiProfile,
      forbidden_zones: [
        { topic: "linguistics", reason: "teste" },
      ],
    };
    const out = await planTurn({
      sessionId: "s1",
      // Boost linguistics para garantir que entra no top-5.
      persona: makePersona({
        profile: {
          parental_profile: strictProfile,
          domain_ranking: { linguistics: { score: 100 } },
        },
      }),
      adquirente,
      inventory,
      state: baseState,
      incomingMessage: "oi",
    });
    // Com boost forte, linguistics hooks dominam top-5 e devem ser todos rejeitados.
    const rejectedIds = out.contextHints["parental_triage_rejected_ids"] as string[] | undefined;
    expect(rejectedIds).toBeDefined();
    expect(rejectedIds!.length).toBeGreaterThan(0);
    // Nenhum item com domain=linguistics sobrevive
    for (const s of out.contentPool) {
      expect(s.item.domain).not.toBe("linguistics");
    }
  });
});

describe("planTurn — parent_pinned via persona.profile.parent_pinned_ids", () => {
  it("item pinned ganha score=PARENT_PINNED_SCORE e vira top-1", async () => {
    // Pinamos um id específico do seed (sem conhecer qual, pegamos o id que a mock triage vai manter)
    // Usamos um id do seed conhecido — ling_inuit_snow (primeiro do seed)
    const persona = makePersona({
      profile: {
        parent_pinned_ids: ["ling_inuit_snow"],
      },
    });
    const out = await planTurn({
      sessionId: "s1",
      persona,
      adquirente,
      inventory,
      state: baseState,
      incomingMessage: "oi",
    });
    const top = out.contentPool[0];
    expect(top?.item.id).toBe("ling_inuit_snow");
    expect(top?.score).toBe(1000); // PARENT_PINNED_SCORE
  });

  it("item rejected sumiu do pool", async () => {
    const persona = makePersona({
      profile: {
        parent_rejected_ids: ["ling_inuit_snow"],
      },
    });
    const out = await planTurn({
      sessionId: "s1",
      persona,
      adquirente,
      inventory,
      state: baseState,
      incomingMessage: "oi",
    });
    const ids = out.contentPool.map((s) => s.item.id);
    expect(ids).not.toContain("ling_inuit_snow");
  });
});
