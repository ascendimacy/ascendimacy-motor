/**
 * S3 (ops#1145) — CriticalReason Zod schema + PlanTurnOutput extension.
 */

import { describe, it, expect } from "vitest";
import { CriticalReasonSchema, CRITICAL_REASONS } from "../src/contracts/critical-reason.js";

describe("CriticalReasonSchema", () => {
  it("é um ZodEnum com exatamente 8 valores", () => {
    expect(CRITICAL_REASONS).toHaveLength(8);
  });

  it("aceita todos os 8 valores da cap-54", () => {
    const valid = [
      "distress",
      "exit",
      "sacrifice_rejection",
      "harm_self",
      "harm_other",
      "freeze",
      "dissociation",
      "shutdown",
    ] as const;
    for (const v of valid) {
      expect(() => CriticalReasonSchema.parse(v)).not.toThrow();
    }
  });

  it("rejeita valor fora do enum", () => {
    expect(() => CriticalReasonSchema.parse("unknown_signal")).toThrow();
    expect(() => CriticalReasonSchema.parse("")).toThrow();
    expect(() => CriticalReasonSchema.parse(null)).toThrow();
  });

  it("CRITICAL_REASONS contém exatamente os 8 gatilhos cap-54", () => {
    const expected = [
      "distress",
      "exit",
      "sacrifice_rejection",
      "harm_self",
      "harm_other",
      "freeze",
      "dissociation",
      "shutdown",
    ];
    expect([...CRITICAL_REASONS].sort()).toEqual(expected.sort());
  });
});
