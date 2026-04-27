import { describe, it, expect } from "vitest";
import { rankPool } from "../src/evaluate.js";
import { selectFromPool, sanitizeMaterialization } from "../src/select.js";
import type { ScoredContentItem, SessionState } from "@ascendimacy/shared";

const stubState: SessionState = {
  sessionId: "test-session",
  trustLevel: 0.5,
  budgetRemaining: 15,
  eventLog: [],
  turn: 1,
};

const makeScored = (id: string, score: number): ScoredContentItem => ({
  item: {
    id,
    type: "curiosity_hook",
    domain: "generic",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 7,
    verified: true,
    base_score: 7,
    fact: "",
    bridge: "",
    quest: "",
    sacrifice_type: "reflect",
  },
  score,
  reasons: [],
});

describe("rankPool", () => {
  it("sorts pool by score descending", () => {
    const pool = [makeScored("a", 3), makeScored("b", 9), makeScored("c", 5)];
    const ranked = rankPool(pool);
    expect(ranked.map((s) => s.item.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate input", () => {
    const pool = [makeScored("a", 3), makeScored("b", 9)];
    rankPool(pool);
    expect(pool.map((s) => s.item.id)).toEqual(["a", "b"]);
  });
});

describe("selectFromPool", () => {
  it("returns top-scored item", () => {
    const pool = [makeScored("a", 3), makeScored("b", 9)];
    const { selected } = selectFromPool(pool, stubState);
    expect(selected.item.id).toBe("b");
  });

  it("throws on empty pool", () => {
    expect(() => selectFromPool([], stubState)).toThrow();
  });

  it("returns newState with budget deducted (motor#36)", () => {
    const pool = [makeScored("a", 5)];
    pool[0]!.item.sacrifice_amount = 3;
    const { newState } = selectFromPool(pool, stubState);
    expect(newState.budgetRemaining).toBeLessThan(stubState.budgetRemaining);
  });
});

describe("sanitizeMaterialization — forbidden words (Bloco 2a inclui contentPool/content_pool)", () => {
  it("removes technical identifiers from materialization", () => {
    const dirty = "O content_pool sugere playbook helix.";
    const clean = sanitizeMaterialization(dirty);
    expect(clean).not.toContain("content_pool");
    expect(clean).not.toContain("playbook");
  });
});
