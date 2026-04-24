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
