import { describe, it, expect } from "vitest";
import { loadSeedPool, buildPool } from "../src/pool-builder.js";
import type { ContentItem } from "@ascendimacy/shared";

const makeHook = (overrides: Partial<ContentItem> = {}): ContentItem =>
  ({
    id: "h1",
    type: "curiosity_hook",
    domain: "biology",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 8,
    verified: true,
    base_score: 7,
    fact: "f",
    bridge: "b",
    quest: "q",
    sacrifice_type: "reflect",
    ...overrides,
  }) as ContentItem;

describe("loadSeedPool", () => {
  it("loads at least 1 content item from default seed", () => {
    const pool = loadSeedPool();
    expect(pool.length).toBeGreaterThan(0);
  });
  it("all loaded items pass isContentItem", () => {
    const pool = loadSeedPool();
    // Each should have required fields.
    for (const item of pool.slice(0, 5)) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.type).toBe("string");
      expect(Array.isArray(item.casel_target)).toBe(true);
    }
  });
});

describe("buildPool — age gate (v2, A.1.2 slot)", () => {
  it("includes items where age fits the range", () => {
    const pool = [
      makeHook({ id: "fits", age_range: [7, 14] }),
      makeHook({ id: "too_old", age_range: [15, 18] }),
      makeHook({ id: "too_young", age_range: [3, 5] }),
    ];
    const built = buildPool(pool, { age: 10 });
    expect(built.map((i) => i.id)).toEqual(["fits"]);
  });

  it("respects edge cases (age === min)", () => {
    const pool = [makeHook({ id: "edge", age_range: [10, 12] })];
    expect(buildPool(pool, { age: 10 })[0]?.id).toBe("edge");
    expect(buildPool(pool, { age: 12 })[0]?.id).toBe("edge");
    expect(buildPool(pool, { age: 13 })).toHaveLength(0);
  });
});

describe("buildPool — group_compatible filter (Bloco 6 prep)", () => {
  it("1v1 mode includes all age-eligible items regardless of group_compatible", () => {
    const pool = [
      makeHook({ id: "individual", group_compatible: false }),
      makeHook({ id: "dyad_ok", group_compatible: true }),
      makeHook({ id: "no_flag" }), // group_compatible undefined
    ];
    const built = buildPool(pool, { age: 10, sessionMode: "1v1" });
    expect(built.map((i) => i.id).sort()).toEqual(["dyad_ok", "individual", "no_flag"]);
  });

  it("joint mode drops items without group_compatible=true", () => {
    const pool = [
      makeHook({ id: "individual", group_compatible: false }),
      makeHook({ id: "dyad_ok", group_compatible: true }),
      makeHook({ id: "no_flag" }),
    ];
    const built = buildPool(pool, { age: 10, sessionMode: "joint" });
    expect(built.map((i) => i.id)).toEqual(["dyad_ok"]);
  });
});

describe("buildPool — refusal tracking is Bloco 3+ (v2, §4.11)", () => {
  it("does NOT filter based on any 'refused' marker in v1", () => {
    // Marca ausente — pool-builder v1 não se importa.
    const pool = [makeHook({ id: "normal" })];
    const built = buildPool(pool, { age: 10 });
    expect(built.map((i) => i.id)).toEqual(["normal"]);
  });
});
