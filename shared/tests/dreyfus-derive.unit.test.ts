import { describe, it, expect } from "vitest";
import { deriveDreyfusLevel } from "../src/dreyfus-derive.js";
import type {
  CardCatalogItem,
  ChallengeItem,
  ContentItem,
  CulturalDiamondItem,
  CuriosityHookItem,
  DynamicItem,
  GtdReviewItem,
  GtdTaskItem,
} from "../src/content-item.js";

/** Builds a minimal valid ContentItem for the requested type. */
function makeItem<T extends ContentItem>(overrides: Partial<T> & { type: T["type"] }): T {
  const base = {
    id: `test_${overrides.type}`,
    domain: "test",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 8,
    verified: true,
    base_score: 7,
  } as const;

  switch (overrides.type) {
    case "curiosity_hook":
      return {
        ...base,
        fact: "f",
        bridge: "b",
        quest: "q",
        sacrifice_type: "reflect",
        ...overrides,
      } as unknown as T;
    case "cultural_diamond":
      return {
        ...base,
        fact: "f",
        bridge: "b",
        quest: "q",
        sacrifice_type: "share",
        ...overrides,
      } as unknown as T;
    case "card_catalog":
      return {
        ...base,
        title: "card",
        rarity: "common",
        trigger_conditions: [],
        recipient_narrative_template: "tpl",
        parent_approval_required: false,
        ...overrides,
      } as unknown as T;
    case "gtd_review":
      return {
        ...base,
        review_kind: "weekly_grow",
        trigger: "weekly",
        template: "t",
        ...overrides,
      } as unknown as T;
    case "gtd_task":
      return {
        ...base,
        generated_for: "child",
        area: "study",
        description: "do thing",
        estimated_minutes: 15,
        parent_visible: false,
        status: "pending",
        ...overrides,
      } as unknown as T;
    case "dynamic":
      return {
        ...base,
        title: "dyn",
        setup: "s",
        execution: "e",
        closing: "c",
        multi_turn: false,
        ...overrides,
      } as unknown as T;
    case "challenge":
      return {
        ...base,
        description: "d",
        expected_outcome: "o",
        estimated_minutes: 20,
        ...overrides,
      } as unknown as T;
    default:
      throw new Error(`unsupported type ${overrides.type}`);
  }
}

describe("deriveDreyfusLevel — type baselines", () => {
  it("curiosity_hook → [novice, apprentice]", () => {
    const item = makeItem<CuriosityHookItem>({ type: "curiosity_hook" });
    expect(deriveDreyfusLevel(item)).toEqual(["novice", "apprentice"]);
  });

  it("cultural_diamond → [practitioner, proficient]", () => {
    const item = makeItem<CulturalDiamondItem>({ type: "cultural_diamond" });
    expect(deriveDreyfusLevel(item)).toEqual(["practitioner", "proficient"]);
  });

  it("challenge → [proficient, expert]", () => {
    const item = makeItem<ChallengeItem>({ type: "challenge" });
    expect(deriveDreyfusLevel(item)).toEqual(["proficient", "expert"]);
  });

  it("gtd_review → [practitioner, proficient]", () => {
    const item = makeItem<GtdReviewItem>({ type: "gtd_review" });
    expect(deriveDreyfusLevel(item)).toEqual(["practitioner", "proficient"]);
  });

  it("dynamic → [apprentice, practitioner]", () => {
    const item = makeItem<DynamicItem>({ type: "dynamic" });
    expect(deriveDreyfusLevel(item)).toEqual(["apprentice", "practitioner"]);
  });
});

describe("deriveDreyfusLevel — card_catalog by rarity", () => {
  it("common → [novice, apprentice]", () => {
    const item = makeItem<CardCatalogItem>({
      type: "card_catalog",
      rarity: "common",
    });
    expect(deriveDreyfusLevel(item)).toEqual(["novice", "apprentice"]);
  });

  it("rare → [apprentice, practitioner]", () => {
    const item = makeItem<CardCatalogItem>({
      type: "card_catalog",
      rarity: "rare",
    });
    expect(deriveDreyfusLevel(item)).toEqual(["apprentice", "practitioner"]);
  });

  it("epic → [practitioner, proficient]", () => {
    const item = makeItem<CardCatalogItem>({
      type: "card_catalog",
      rarity: "epic",
    });
    expect(deriveDreyfusLevel(item)).toEqual(["practitioner", "proficient"]);
  });

  it("legendary → [proficient, expert]", () => {
    const item = makeItem<CardCatalogItem>({
      type: "card_catalog",
      rarity: "legendary",
    });
    expect(deriveDreyfusLevel(item)).toEqual(["proficient", "expert"]);
  });
});

describe("deriveDreyfusLevel — gtd_task by estimated_minutes", () => {
  it("≤10 min → [novice, apprentice]", () => {
    const item = makeItem<GtdTaskItem>({
      type: "gtd_task",
      estimated_minutes: 5,
    });
    expect(deriveDreyfusLevel(item)).toEqual(["novice", "apprentice"]);
  });

  it(">30 min → [proficient, expert]", () => {
    const item = makeItem<GtdTaskItem>({
      type: "gtd_task",
      estimated_minutes: 45,
    });
    expect(deriveDreyfusLevel(item)).toEqual(["proficient", "expert"]);
  });

  it("between (15) → [apprentice, practitioner]", () => {
    const item = makeItem<GtdTaskItem>({
      type: "gtd_task",
      estimated_minutes: 15,
    });
    expect(deriveDreyfusLevel(item)).toEqual(["apprentice", "practitioner"]);
  });
});

describe("deriveDreyfusLevel — secondary modifiers", () => {
  it("sacrifice_amount ≥15 tilts +1 toward expert", () => {
    const item = makeItem<CuriosityHookItem>({
      type: "curiosity_hook",
      sacrifice_amount: 20,
    });
    // baseline novice-apprentice → +1 = apprentice-practitioner
    expect(deriveDreyfusLevel(item)).toEqual(["apprentice", "practitioner"]);
  });

  it("sacrifice high on challenge clamps at expert", () => {
    const item = makeItem<ChallengeItem>({
      type: "challenge",
      sacrifice_amount: 25,
    });
    // baseline proficient-expert → +1 clamps to expert-expert
    expect(deriveDreyfusLevel(item)).toEqual(["expert", "expert"]);
  });

  it("low surprise + verified tilts -1 toward novice", () => {
    const item = makeItem<CulturalDiamondItem>({
      type: "cultural_diamond",
      surprise: 3,
      verified: true,
    });
    // baseline practitioner-proficient → -1 = apprentice-practitioner
    expect(deriveDreyfusLevel(item)).toEqual(["apprentice", "practitioner"]);
  });

  it("low surprise but NOT verified ⇒ no tilt", () => {
    const item = makeItem<CulturalDiamondItem>({
      type: "cultural_diamond",
      surprise: 3,
      verified: false,
    });
    expect(deriveDreyfusLevel(item)).toEqual(["practitioner", "proficient"]);
  });

  it("sacrifice high wins over surprise low (no double-tilt)", () => {
    const item = makeItem<CuriosityHookItem>({
      type: "curiosity_hook",
      sacrifice_amount: 20,
      surprise: 2,
      verified: true,
    });
    // sacrifice +1 applied, surprise -1 suppressed → apprentice-practitioner
    expect(deriveDreyfusLevel(item)).toEqual(["apprentice", "practitioner"]);
  });
});

describe("deriveDreyfusLevel — edge cases", () => {
  it("missing sacrifice_amount treated as none", () => {
    const item = makeItem<CuriosityHookItem>({ type: "curiosity_hook" });
    expect(deriveDreyfusLevel(item)).toEqual(["novice", "apprentice"]);
  });

  it("low surprise tilt clamps at novice", () => {
    const item = makeItem<CuriosityHookItem>({
      type: "curiosity_hook",
      surprise: 1,
      verified: true,
    });
    // baseline novice-apprentice → -1 clamps to novice-novice
    expect(deriveDreyfusLevel(item)).toEqual(["novice", "novice"]);
  });

  it("function is deterministic (same input → same output)", () => {
    const item = makeItem<ChallengeItem>({
      type: "challenge",
      sacrifice_amount: 18,
    });
    const a = deriveDreyfusLevel(item);
    const b = deriveDreyfusLevel(item);
    expect(a).toEqual(b);
  });
});
