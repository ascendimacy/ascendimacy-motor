import { describe, it, expect } from "vitest";
import { LearnerSummarySchema } from "../../src/contracts/learner-summary.js";

const valid = {
  persona: "ryo",
  casel_levels: { SA: 2, SM: 1 },
  tree_zones: ["raiz", "tronco"],
  helix_position: "active",
  last_session: "2026-05-26T10:00:00.000Z",
  cached_at: 1716720000000,
};

describe("LearnerSummarySchema", () => {
  it("accepts valid shape", () => {
    const result = LearnerSummarySchema.parse(valid);
    expect(result.persona).toBe("ryo");
    expect(result.casel_levels).toEqual({ SA: 2, SM: 1 });
    expect(result.tree_zones).toEqual(["raiz", "tronco"]);
  });

  it("accepts null helix_position and last_session", () => {
    const result = LearnerSummarySchema.parse({
      ...valid,
      helix_position: null,
      last_session: null,
    });
    expect(result.helix_position).toBeNull();
    expect(result.last_session).toBeNull();
  });

  it("accepts empty casel_levels and tree_zones", () => {
    expect(() =>
      LearnerSummarySchema.parse({ ...valid, casel_levels: {}, tree_zones: [] }),
    ).not.toThrow();
  });

  it("rejects missing persona field", () => {
    const { persona: _, ...rest } = valid;
    expect(() => LearnerSummarySchema.parse(rest)).toThrow();
  });

  it("rejects empty persona string", () => {
    expect(() =>
      LearnerSummarySchema.parse({ ...valid, persona: "" }),
    ).toThrow();
  });

  it("rejects non-number casel_levels values", () => {
    expect(() =>
      LearnerSummarySchema.parse({ ...valid, casel_levels: { SA: "high" } }),
    ).toThrow();
  });

  it("rejects non-string tree_zones elements", () => {
    expect(() =>
      LearnerSummarySchema.parse({ ...valid, tree_zones: [1, 2] }),
    ).toThrow();
  });

  it("rejects undefined helix_position (must be string | null)", () => {
    expect(() =>
      LearnerSummarySchema.parse({ ...valid, helix_position: undefined }),
    ).toThrow();
  });

  it("rejects missing cached_at", () => {
    const { cached_at: _, ...rest } = valid;
    expect(() => LearnerSummarySchema.parse(rest)).toThrow();
  });
});
