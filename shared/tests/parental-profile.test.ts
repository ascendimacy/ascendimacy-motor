import { describe, it, expect } from "vitest";
import { isParentalProfileMinimal } from "../src/parental-profile.js";
import type { ParentalProfile } from "../src/parental-profile.js";

const base: ParentalProfile = {
  id: "yuji",
  role: "primary",
  decision_profile: "consultative_risk_averse",
  family_values: {
    principles: ["p1"],
  },
  forbidden_zones: [{ topic: "political_content", reason: "x" }],
  budget_constraints: { screen_time_daily_max_minutes: 90 },
  parental_availability: {
    scale_tolerance: { medio: "yes" },
  },
};

describe("isParentalProfileMinimal", () => {
  it("accepts profile with all required fields", () => {
    expect(isParentalProfileMinimal(base)).toBe(true);
  });

  it("rejects undefined", () => {
    expect(isParentalProfileMinimal(undefined)).toBe(false);
  });

  it("rejects empty family_values.principles", () => {
    const p = { ...base, family_values: { principles: [] } };
    expect(isParentalProfileMinimal(p)).toBe(false);
  });

  it("rejects missing forbidden_zones", () => {
    const p = { ...base } as Partial<ParentalProfile>;
    delete (p as { forbidden_zones?: unknown }).forbidden_zones;
    expect(isParentalProfileMinimal(p as ParentalProfile)).toBe(false);
  });

  it("rejects missing parental_availability", () => {
    const p = { ...base } as Partial<ParentalProfile>;
    delete (p as { parental_availability?: unknown }).parental_availability;
    expect(isParentalProfileMinimal(p as ParentalProfile)).toBe(false);
  });
});
