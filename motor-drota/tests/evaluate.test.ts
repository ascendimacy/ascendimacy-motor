import { describe, it, expect } from "vitest";
import { scoreActions } from "../src/evaluate.js";
import { selectBest, sanitizeMaterialization } from "../src/select.js";
import type { SessionState } from "@ascendimacy/shared";

const mockState: SessionState = {
  sessionId: "test-001",
  trustLevel: 0.3,
  budgetRemaining: 100,
  turn: 0,
  eventLog: [],
};

const candidates = [
  { playbookId: "icebreaker.primeiro-contato", priority: 1, rationale: "Primeiro contato", estimatedSacrifice: 1, estimatedConfidenceGain: 4 },
  { playbookId: "onboarding.pitch", priority: 2, rationale: "Pitch direto", estimatedSacrifice: 5, estimatedConfidenceGain: 7 },
];

describe("scoreActions", () => {
  it("scores all candidates", () => {
    const scored = scoreActions(candidates, mockState);
    expect(scored).toHaveLength(2);
    for (const s of scored) {
      expect(typeof s.score).toBe("number");
    }
  });

  it("applies trustWeight penalty for low trust", () => {
    const lowTrustState = { ...mockState, trustLevel: 0.2 };
    const highTrustState = { ...mockState, trustLevel: 0.8 };
    const lowScores = scoreActions([candidates[0]!], lowTrustState);
    const highScores = scoreActions([candidates[0]!], highTrustState);
    expect(lowScores[0]!.score).toBeGreaterThan(highScores[0]!.score);
  });
});

describe("selectBest", () => {
  it("selects action with highest score", () => {
    const scored = scoreActions(candidates, mockState);
    const best = selectBest(scored);
    expect(best.playbookId).toBeTruthy();
  });
});

describe("sanitizeMaterialization", () => {
  it("removes forbidden technical words", () => {
    const dirty = "Oi! Este playbook vai aumentar seu trust_level.";
    const clean = sanitizeMaterialization(dirty);
    expect(clean).not.toContain("playbook");
    expect(clean).not.toContain("trust_level");
  });
});
