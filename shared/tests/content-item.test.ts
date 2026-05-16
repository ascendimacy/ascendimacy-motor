import { describe, it, expect } from "vitest";
import { DREYFUS_LEVELS, isContentItem } from "../src/content-item.js";
import type { ContentItem, DreyfusLevel } from "../src/content-item.js";
import seed from "../../content/hooks/seed.json" with { type: "json" };

const validHook: ContentItem = {
  id: "hook_test",
  type: "curiosity_hook",
  domain: "biology",
  casel_target: ["SA"],
  age_range: [7, 14],
  surprise: 8,
  verified: true,
  base_score: 7,
  fact: "x",
  bridge: "y",
  quest: "z",
  sacrifice_type: "reflect",
};

describe("isContentItem", () => {
  it("accepts a valid curiosity_hook", () => {
    expect(isContentItem(validHook)).toBe(true);
  });

  it("rejects null / non-object", () => {
    expect(isContentItem(null)).toBe(false);
    expect(isContentItem("str")).toBe(false);
    expect(isContentItem(42)).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isContentItem({ ...validHook, type: "bogus" })).toBe(false);
  });

  it("rejects unknown casel dimension", () => {
    expect(isContentItem({ ...validHook, casel_target: ["XYZ"] })).toBe(false);
  });

  it("rejects bad age_range shape", () => {
    expect(isContentItem({ ...validHook, age_range: [7] })).toBe(false);
    expect(isContentItem({ ...validHook, age_range: ["a", "b"] })).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...rest } = validHook;
    expect(isContentItem(rest)).toBe(false);
  });

  it("accepts a valid dreyfus_level_target tuple", () => {
    const withDreyfus: ContentItem = {
      ...validHook,
      dreyfus_level_target: ["novice", "apprentice"],
    };
    expect(isContentItem(withDreyfus)).toBe(true);
  });

  it("rejects dreyfus_level_target with bad enum value", () => {
    expect(
      isContentItem({
        ...validHook,
        dreyfus_level_target: ["novice", "guru"],
      }),
    ).toBe(false);
  });

  it("rejects dreyfus_level_target with wrong arity", () => {
    expect(
      isContentItem({
        ...validHook,
        dreyfus_level_target: ["novice"],
      }),
    ).toBe(false);
  });

  it("accepts undefined dreyfus_level_target (backward compat)", () => {
    const { ...rest } = validHook;
    delete (rest as { dreyfus_level_target?: unknown }).dreyfus_level_target;
    expect(isContentItem(rest)).toBe(true);
  });

  it("exports DREYFUS_LEVELS with 5 ordered levels", () => {
    expect(DREYFUS_LEVELS).toEqual([
      "novice",
      "apprentice",
      "practitioner",
      "proficient",
      "expert",
    ] as const);
  });
});

describe("hooks seed integrity", () => {
  it("has 85 items (matches CURIOSITY_HOOKS_BANK.MD)", () => {
    expect(seed.length).toBe(85);
  });

  it("every seed item passes isContentItem", () => {
    for (const item of seed) {
      expect(isContentItem(item), `failed: ${JSON.stringify(item)}`).toBe(true);
    }
  });

  it("every seed item is a curiosity_hook with fact/bridge/quest", () => {
    for (const item of seed as ContentItem[]) {
      expect(item.type).toBe("curiosity_hook");
      if (item.type === "curiosity_hook") {
        expect(item.fact.length).toBeGreaterThan(0);
        expect(item.bridge.length).toBeGreaterThan(0);
        expect(item.quest.length).toBeGreaterThan(0);
      }
    }
  });

  it("ids are unique", () => {
    const ids = new Set<string>();
    for (const item of seed) {
      expect(ids.has(item.id), `duplicate id: ${item.id}`).toBe(false);
      ids.add(item.id);
    }
  });

  it("every seed item has dreyfus_level_target as valid tuple (ops#1015)", () => {
    for (const item of seed as ContentItem[]) {
      expect(
        item.dreyfus_level_target,
        `missing dreyfus_level_target: ${item.id}`,
      ).toBeDefined();
      const range = item.dreyfus_level_target!;
      expect(range.length).toBe(2);
      expect(DREYFUS_LEVELS).toContain(range[0] as DreyfusLevel);
      expect(DREYFUS_LEVELS).toContain(range[1] as DreyfusLevel);
    }
  });
});
