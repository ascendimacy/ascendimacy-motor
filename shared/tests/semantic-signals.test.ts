/**
 * Tests semantic-signals taxonomy (motor#25).
 */

import { describe, it, expect } from "vitest";
import {
  SEMANTIC_SIGNALS,
  SIGNAL_DESCRIPTIONS,
  isSemanticSignal,
} from "../src/semantic-signals.js";

describe("SEMANTIC_SIGNALS taxonomy v0", () => {
  it("tem exatamente 15 signals (DA-PRE-PILOTO-01 default)", () => {
    expect(SEMANTIC_SIGNALS).toHaveLength(15);
  });

  it("inclui frame/meta-cognição (4 signals de alto valor pedagógico)", () => {
    expect(SEMANTIC_SIGNALS).toContain("philosophical_self_acceptance");
    expect(SEMANTIC_SIGNALS).toContain("frame_rejection");
    expect(SEMANTIC_SIGNALS).toContain("meta_cognitive_observation");
    expect(SEMANTIC_SIGNALS).toContain("frame_synthesis");
  });

  it("inclui distress markers (high + low)", () => {
    expect(SEMANTIC_SIGNALS).toContain("distress_marker_high");
    expect(SEMANTIC_SIGNALS).toContain("distress_marker_low");
  });

  it("inclui mood drift (up + down)", () => {
    expect(SEMANTIC_SIGNALS).toContain("mood_drift_up");
    expect(SEMANTIC_SIGNALS).toContain("mood_drift_down");
  });

  it("todos signals têm descrição", () => {
    for (const s of SEMANTIC_SIGNALS) {
      expect(SIGNAL_DESCRIPTIONS[s]).toBeTruthy();
      expect(SIGNAL_DESCRIPTIONS[s].length).toBeGreaterThan(20);
    }
  });

  it("descrições não duplicadas", () => {
    const descs = SEMANTIC_SIGNALS.map((s) => SIGNAL_DESCRIPTIONS[s]);
    expect(new Set(descs).size).toBe(descs.length);
  });
});

describe("isSemanticSignal type guard", () => {
  it("aceita signals válidos", () => {
    expect(isSemanticSignal("philosophical_self_acceptance")).toBe(true);
    expect(isSemanticSignal("distress_marker_high")).toBe(true);
  });

  it("rejeita signals inválidos", () => {
    expect(isSemanticSignal("philosophical_acceptance")).toBe(false); // typo
    expect(isSemanticSignal("")).toBe(false);
    expect(isSemanticSignal("PHILOSOPHICAL_SELF_ACCEPTANCE")).toBe(false); // case
  });

  it("type narrowing funciona", () => {
    const candidates: string[] = ["frame_rejection", "invalid"];
    const valid = candidates.filter(isSemanticSignal);
    expect(valid).toEqual(["frame_rejection"]);
  });
});
