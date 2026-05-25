/**
 * Tests dos campos opcionais Subject Knowledge spec 2026-05-25 Fase 1.
 * Garante que campos novos não quebram fixtures existentes — adoção gradual.
 */
import { describe, it, expect } from "vitest";
import { isParentalProfileMinimal } from "../src/parental-profile.js";
import type {
  ParentalProfile,
  ParentalAspirations,
  CulturalFilter,
  FlashesSetting,
} from "../src/parental-profile.js";

const baseMinimal: ParentalProfile = {
  id: "yuji",
  role: "primary",
  decision_profile: "consultative_risk_averse",
  family_values: { principles: ["esforço"] },
  forbidden_zones: [{ topic: "x", reason: "y" }],
  budget_constraints: {},
  parental_availability: {},
};

describe("ParentalProfile — Subject Knowledge fields (opcionais)", () => {
  it("perfil minimal sem campos novos continua válido", () => {
    expect(isParentalProfileMinimal(baseMinimal)).toBe(true);
  });

  it("aceita aspirations completas sem afetar minimal", () => {
    const aspirations: ParentalAspirations = {
      proposed_traits: ["autoconfiança", "empatia"],
      proposed_virtues: [
        { axis: 3, note: "coragem civil" },
        { axis: 7 },
      ],
      proposed_competencies: ["responsabilidade acadêmica"],
    };
    const p: ParentalProfile = { ...baseMinimal, aspirations };
    expect(isParentalProfileMinimal(p)).toBe(true);
    expect(p.aspirations?.proposed_virtues?.[0].axis).toBe(3);
  });

  it("aceita latent_needs e parent_claimed_interests distintos", () => {
    const p: ParentalProfile = {
      ...baseMinimal,
      latent_needs: ["abertura emocional"],
      parent_claimed_interests: ["Pokemon"],
    };
    expect(p.latent_needs).toHaveLength(1);
    expect(p.parent_claimed_interests).toEqual(["Pokemon"]);
  });

  it("cultural_filter aceita allowed/blocked", () => {
    const culturalFilter: CulturalFilter = {
      allowed_lineages: ["aristotelica", "estoica", "bushido", "zen"],
      blocked_lineages: [],
    };
    const p: ParentalProfile = { ...baseMinimal, cultural_filter: culturalFilter };
    expect(p.cultural_filter?.allowed_lineages).toContain("estoica");
  });

  it("flashes_setting aceita as 3 variantes", () => {
    const variants: FlashesSetting[] = ["off", "occasional", "frequent"];
    for (const v of variants) {
      const p: ParentalProfile = { ...baseMinimal, flashes_setting: v };
      expect(p.flashes_setting).toBe(v);
    }
  });

  it("recall_check_budget_per_session aceita 0..2", () => {
    for (const n of [0, 1, 2]) {
      const p: ParentalProfile = {
        ...baseMinimal,
        recall_check_budget_per_session: n,
      };
      expect(p.recall_check_budget_per_session).toBe(n);
    }
  });
});
