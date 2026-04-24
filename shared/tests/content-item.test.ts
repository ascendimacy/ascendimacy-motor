import { describe, it, expect } from "vitest";
import { isContentItem } from "../src/content-item.js";
import type { ContentItem } from "../src/content-item.js";
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
});
