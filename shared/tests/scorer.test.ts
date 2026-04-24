import { describe, it, expect } from "vitest";
import {
  scoreItem,
  scorePool,
  PARENT_PINNED_SCORE,
  CASEL_FOCUS_BONUS,
  TREE_TOP_DOMAIN_BONUS,
  RECENT_DOMAIN_PENALTY,
  DECAY_BY_TYPE,
} from "../src/scorer.js";
import type { ChildScoringProfile, ScoringContext } from "../src/scorer.js";
import type { ContentItem } from "../src/content-item.js";

const hook = (overrides: Partial<ContentItem> = {}): ContentItem =>
  ({
    id: "h1",
    type: "curiosity_hook",
    domain: "biology",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 7,
    verified: true,
    base_score: 7,
    fact: "f",
    bridge: "b",
    quest: "q",
    sacrifice_type: "reflect",
    ...overrides,
  }) as ContentItem;

const baseChild: ChildScoringProfile = { age: 10 };
const NOW = "2026-04-24T12:00:00Z";
const baseCtx: ScoringContext = { now: NOW };

describe("scoreItem — age gate", () => {
  it("returns 0 when child age is below range", () => {
    const res = scoreItem(hook({ age_range: [12, 14] }), { age: 10 }, baseCtx);
    expect(res.score).toBe(0);
    expect(res.reasons[0]).toMatch(/age_out_of_range/);
  });

  it("returns 0 when child age is above range", () => {
    const res = scoreItem(hook({ age_range: [7, 9] }), { age: 10 }, baseCtx);
    expect(res.score).toBe(0);
  });
});

describe("scoreItem — parent pin", () => {
  it("returns PARENT_PINNED_SCORE when pinned and not expired", () => {
    const res = scoreItem(
      hook({ parent_pinned: true, pinned_until: "2099-01-01T00:00:00Z" }),
      baseChild,
      baseCtx,
    );
    expect(res.score).toBe(PARENT_PINNED_SCORE);
    expect(res.reasons).toContain("parent_pinned");
  });

  it("returns PARENT_PINNED_SCORE when pinned with null expiry", () => {
    const res = scoreItem(
      hook({ parent_pinned: true, pinned_until: null }),
      baseChild,
      baseCtx,
    );
    expect(res.score).toBe(PARENT_PINNED_SCORE);
  });

  it("ignores pin when expired", () => {
    const res = scoreItem(
      hook({ parent_pinned: true, pinned_until: "2020-01-01T00:00:00Z" }),
      baseChild,
      baseCtx,
    );
    expect(res.score).toBeLessThan(PARENT_PINNED_SCORE);
  });

  it("age gate beats parent pin (safety)", () => {
    const res = scoreItem(
      hook({ parent_pinned: true, age_range: [15, 18] }),
      { age: 10 },
      baseCtx,
    );
    expect(res.score).toBe(0);
  });
});

describe("scoreItem — base + surprise", () => {
  it("baseline = base_score when no bonuses apply", () => {
    const res = scoreItem(hook(), baseChild, baseCtx);
    expect(res.score).toBe(7);
  });

  it("surprise above 7 adds bonus", () => {
    const res = scoreItem(hook({ surprise: 10 }), baseChild, baseCtx);
    expect(res.score).toBe(7 + (10 - 7) * 2); // 13
  });

  it("surprise below 7 is a negative bonus", () => {
    const res = scoreItem(hook({ surprise: 5 }), baseChild, baseCtx);
    expect(res.score).toBe(7 + (5 - 7) * 2); // 3
  });
});

describe("scoreItem — domain interest + context bonuses", () => {
  it("adds child.domain_ranking bonus", () => {
    const res = scoreItem(
      hook(),
      { age: 10, domain_ranking: { biology: { score: 4 } } },
      baseCtx,
    );
    expect(res.score).toBe(7 + 4);
  });

  it("adds CASEL focus bonus when target matches", () => {
    const res = scoreItem(
      hook({ casel_target: ["REL"] }),
      baseChild,
      { ...baseCtx, casel_focus: "REL" },
    );
    expect(res.score).toBe(7 + CASEL_FOCUS_BONUS);
  });

  it("does NOT add CASEL bonus when target mismatches", () => {
    const res = scoreItem(
      hook({ casel_target: ["SA"] }),
      baseChild,
      { ...baseCtx, casel_focus: "REL" },
    );
    expect(res.score).toBe(7);
  });

  it("adds tree_top_domain bonus when top node key contains domain", () => {
    const res = scoreItem(
      hook({ domain: "biology" }),
      baseChild,
      { ...baseCtx, top_tree_node: { key: "curiosidade_biology_dna", score: 8 } },
    );
    expect(res.score).toBe(7 + TREE_TOP_DOMAIN_BONUS);
  });

  it("applies recent_domain penalty when domain in recent hooks", () => {
    const res = scoreItem(
      hook(),
      { age: 10, recent_hook_domains: ["biology", "physics", "history"] },
      baseCtx,
    );
    expect(res.score).toBe(7 - RECENT_DOMAIN_PENALTY);
  });

  it("ignores recent domains beyond the top 5", () => {
    const res = scoreItem(
      hook({ domain: "biology" }),
      { age: 10, recent_hook_domains: ["a", "b", "c", "d", "e", "biology"] },
      baseCtx,
    );
    expect(res.score).toBe(7);
  });

  it("stacks engagement_by_type bonus (×0.5)", () => {
    const res = scoreItem(
      hook(),
      { age: 10, engagement_by_type: { curiosity_hook: 4 } },
      baseCtx,
    );
    expect(res.score).toBe(7 + 4 * 0.5);
  });
});

describe("scoreItem — temporal decay", () => {
  it("applies half-life decay for curiosity_hook (14d)", () => {
    // Exactly one half-life passed → score halved.
    const fourteenDaysAgo = "2026-04-10T12:00:00Z";
    const res = scoreItem(
      hook({ last_used_at: fourteenDaysAgo }),
      baseChild,
      baseCtx,
    );
    expect(res.score).toBeCloseTo(7 * 0.5, 5);
  });

  it("no decay when last_used_at is null", () => {
    const res = scoreItem(hook({ last_used_at: null }), baseChild, baseCtx);
    expect(res.score).toBe(7);
  });

  it("card_catalog never decays (Infinity half-life)", () => {
    const tenYearsAgo = "2016-04-24T12:00:00Z";
    // Construct a card manually so the type narrows.
    const card: ContentItem = {
      id: "c1",
      type: "card_catalog",
      domain: "general",
      casel_target: ["SM"],
      age_range: [7, 14],
      surprise: 7,
      verified: true,
      base_score: 10,
      last_used_at: tenYearsAgo,
      title: "t",
      rarity: "rare",
      trigger_conditions: [],
      recipient_narrative_template: "x",
      parent_approval_required: true,
    };
    const res = scoreItem(card, baseChild, baseCtx);
    expect(res.score).toBe(10);
    expect(DECAY_BY_TYPE.card_catalog).toBe(Infinity);
  });
});

describe("scorePool", () => {
  it("sorts results desc by score", () => {
    const pool = [
      hook({ id: "low", surprise: 5 }),
      hook({ id: "high", surprise: 10 }),
      hook({ id: "mid", surprise: 8 }),
    ];
    const scored = scorePool(pool, baseChild, baseCtx);
    expect(scored.map((s) => s.item.id)).toEqual(["high", "mid", "low"]);
  });

  it("items with parent_pinned win", () => {
    const pool = [
      hook({ id: "normal", surprise: 10 }),
      hook({
        id: "pinned",
        surprise: 5,
        parent_pinned: true,
        pinned_until: null,
      }),
    ];
    const scored = scorePool(pool, baseChild, baseCtx);
    expect(scored[0].item.id).toBe("pinned");
    expect(scored[0].score).toBe(PARENT_PINNED_SCORE);
  });

  it("age-inelegible items drop to bottom", () => {
    const pool = [
      hook({ id: "too_old", age_range: [15, 18] }),
      hook({ id: "fits", surprise: 8 }),
    ];
    const scored = scorePool(pool, { age: 10 }, baseCtx);
    expect(scored[0].item.id).toBe("fits");
    expect(scored[scored.length - 1].item.id).toBe("too_old");
    expect(scored[scored.length - 1].score).toBe(0);
  });
});
