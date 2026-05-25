import { describe, it, expect } from "vitest";
import { personaToChildProfile, cyclePhaseFor } from "../src/child-profile.js";
import type { PersonaDef, SessionState } from "@ascendimacy/shared";

const makePersona = (overrides: Partial<PersonaDef> = {}): PersonaDef => ({
  id: "ryo",
  name: "Ryo",
  age: 13,
  profile: {},
  ...overrides,
});

const emptyState: SessionState = {
  sessionId: "s1",
  trustLevel: 0.3,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
};

describe("personaToChildProfile", () => {
  it("uses persona.age", () => {
    const p = personaToChildProfile(makePersona({ age: 11 }), emptyState);
    expect(p.age).toBe(11);
  });

  it("extracts domain_ranking from profile when present", () => {
    const persona = makePersona({
      profile: { domain_ranking: { biology: { score: 4 } } },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.domain_ranking?.["biology"]).toEqual({ score: 4 });
  });

  it("omits domain_ranking when profile doesn't declare", () => {
    const p = personaToChildProfile(makePersona(), emptyState);
    expect(p.domain_ranking).toBeUndefined();
  });

  it("propagates cycle_day from profile and derives cycle_phase", () => {
    const persona = makePersona({ profile: { cycle_day: 5 } });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.cycle_day).toBe(5);
    expect(p.cycle_phase).toBe("building");
  });

  it("recent_hook_domains is empty in v1 (Bloco 3 fills)", () => {
    const p = personaToChildProfile(makePersona(), emptyState);
    expect(p.recent_hook_domains).toEqual([]);
  });
});

describe("cyclePhaseFor", () => {
  it("maps 1-3 → rapport", () => {
    expect(cyclePhaseFor(1)).toBe("rapport");
    expect(cyclePhaseFor(3)).toBe("rapport");
  });
  it("maps 4-7 → building", () => {
    expect(cyclePhaseFor(4)).toBe("building");
    expect(cyclePhaseFor(7)).toBe("building");
  });
  it("maps 8-10 → peak", () => {
    expect(cyclePhaseFor(8)).toBe("peak");
    expect(cyclePhaseFor(10)).toBe("peak");
  });
  it("maps 11-14 → consolidation", () => {
    expect(cyclePhaseFor(14)).toBe("consolidation");
  });
  it("maps 15-18 → buffer", () => {
    expect(cyclePhaseFor(18)).toBe("buffer");
  });
  it("undefined outside 1-18 or undefined input", () => {
    expect(cyclePhaseFor(undefined)).toBeUndefined();
    expect(cyclePhaseFor(0)).toBeUndefined();
    expect(cyclePhaseFor(19)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// Subject Knowledge hidratação (latent_needs + subject_proposed)
// ─────────────────────────────────────────────────────────────────

describe("personaToChildProfile — Subject Knowledge fields", () => {
  it("extrai latent_needs de parental_profile.latent_needs", () => {
    const persona = makePersona({
      profile: {
        parental_profile: {
          latent_needs: ["autocontrole", "abertura emocional", " perda do tio Kenji "],
        },
      },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.latent_needs).toEqual([
      "autocontrole",
      "abertura emocional",
      "perda do tio Kenji",
    ]);
  });

  it("omite latent_needs quando array vazio", () => {
    const persona = makePersona({
      profile: { parental_profile: { latent_needs: [] } },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.latent_needs).toBeUndefined();
  });

  it("omite latent_needs quando parental_profile ausente", () => {
    const persona = makePersona({ profile: {} });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.latent_needs).toBeUndefined();
  });

  it("filtra strings vazias e tipos inválidos em latent_needs", () => {
    const persona = makePersona({
      profile: {
        parental_profile: {
          latent_needs: ["autocontrole", "", 42, null, "  ", "abertura"],
        },
      },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.latent_needs).toEqual(["autocontrole", "abertura"]);
  });

  it("extrai subject_proposed.axes_active de aspirations.proposed_virtues", () => {
    const persona = makePersona({
      profile: {
        parental_profile: {
          aspirations: {
            proposed_virtues: [
              { axis: 3, note: "coragem civil" },
              { axis: 7 },
              { axis: 12 },
            ],
          },
        },
      },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.subject_proposed?.axes_active).toEqual([3, 7, 12]);
  });

  it("dedup axes_active mesmo com virtudes repetidas", () => {
    const persona = makePersona({
      profile: {
        parental_profile: {
          aspirations: {
            proposed_virtues: [{ axis: 3 }, { axis: 3 }, { axis: 7 }],
          },
        },
      },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.subject_proposed?.axes_active).toEqual([3, 7]);
  });

  it("complements_per_axis vazio pra cada axis (v1)", () => {
    const persona = makePersona({
      profile: {
        parental_profile: {
          aspirations: { proposed_virtues: [{ axis: 4 }, { axis: 11 }] },
        },
      },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.subject_proposed?.complements_per_axis).toEqual({ 4: [], 11: [] });
  });

  it("ignora axes fora de 1..12", () => {
    const persona = makePersona({
      profile: {
        parental_profile: {
          aspirations: {
            proposed_virtues: [{ axis: 0 }, { axis: 13 }, { axis: 5 }],
          },
        },
      },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.subject_proposed?.axes_active).toEqual([5]);
  });

  it("omite subject_proposed quando aspirations ausente", () => {
    const persona = makePersona({
      profile: { parental_profile: { latent_needs: ["x"] } },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.subject_proposed).toBeUndefined();
    expect(p.latent_needs).toEqual(["x"]);
  });

  it("omite subject_proposed quando proposed_virtues vazio", () => {
    const persona = makePersona({
      profile: {
        parental_profile: { aspirations: { proposed_virtues: [] } },
      },
    });
    const p = personaToChildProfile(persona, emptyState);
    expect(p.subject_proposed).toBeUndefined();
  });

  it("preserva backcompat — persona sem subject knowledge fields funciona", () => {
    const persona = makePersona({});
    const p = personaToChildProfile(persona, emptyState);
    expect(p.age).toBe(13);
    expect(p.subject_proposed).toBeUndefined();
    expect(p.latent_needs).toBeUndefined();
  });
});
