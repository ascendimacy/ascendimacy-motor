import { describe, it, expect } from "vitest";
import { onboardingToGardnerAssessment } from "../src/gardner-onboarding.js";
import { isAssessmentReady } from "../src/mixins/with-gardner-program.js";

describe("onboardingToGardnerAssessment", () => {
  it("converts perceived strengths into top channels", () => {
    const a = onboardingToGardnerAssessment({
      perceived_strengths: [
        { channel: "linguistic" },
        { channel: "spatial" },
        { channel: "intrapersonal" },
      ],
      perceived_weaknesses: [{ channel: "musical" }, { channel: "naturalist" }],
      sessions_completed: 3,
    });
    expect(a.top).toEqual(["linguistic", "spatial", "intrapersonal"]);
    expect(a.bottom).toEqual(["musical", "naturalist"]);
    expect(a.sessions_observed).toBe(3);
  });

  it("result passes isAssessmentReady when sessions >= 3", () => {
    const a = onboardingToGardnerAssessment({
      perceived_strengths: [{ channel: "linguistic" }],
      perceived_weaknesses: [{ channel: "musical" }],
      sessions_completed: 3,
    });
    expect(isAssessmentReady(a)).toBe(true);
  });

  it("fails isAssessmentReady when sessions < 3", () => {
    const a = onboardingToGardnerAssessment({
      perceived_strengths: [{ channel: "linguistic" }],
      perceived_weaknesses: [{ channel: "musical" }],
      sessions_completed: 2,
    });
    expect(isAssessmentReady(a)).toBe(false);
  });

  it("dedupes channels mentioned twice", () => {
    const a = onboardingToGardnerAssessment({
      perceived_strengths: [
        { channel: "linguistic" },
        { channel: "linguistic" },
        { channel: "spatial" },
      ],
      sessions_completed: 3,
    });
    expect(a.top).toEqual(["linguistic", "spatial"]);
  });

  it("falls back to untouched channels when pai não deu nada", () => {
    const a = onboardingToGardnerAssessment({ sessions_completed: 3 });
    expect(a.top.length).toBeGreaterThanOrEqual(1);
    expect(a.bottom.length).toBeGreaterThanOrEqual(1);
  });

  it("negative sessions_completed clamped a 0", () => {
    const a = onboardingToGardnerAssessment({ sessions_completed: -5 });
    expect(a.sessions_observed).toBe(0);
  });

  it("caps top at 4 channels (tabela §4.2 de 5 semanas)", () => {
    const a = onboardingToGardnerAssessment({
      perceived_strengths: [
        { channel: "linguistic" },
        { channel: "spatial" },
        { channel: "intrapersonal" },
        { channel: "interpersonal" },
        { channel: "logical_mathematical" },
      ],
      sessions_completed: 3,
    });
    expect(a.top).toHaveLength(4);
  });
});
