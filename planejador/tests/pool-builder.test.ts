import { describe, it, expect } from "vitest";
import { loadSeedPool, buildPool, slicePoolForDrota } from "../src/pool-builder.js";
import type { ContentItem, ScoredContentItem } from "@ascendimacy/shared";

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

// motor#25 (handoff #24 Tarefa 1) — slicePoolForDrota
describe("slicePoolForDrota — char budget + max items + filter score≤0", () => {
  const makeScored = (id: string, score: number, charsHint = 200): ScoredContentItem => {
    const padding = "x".repeat(Math.max(0, charsHint - 20));
    return {
      item: makeHook({ id, fact: padding, bridge: "b", quest: "q" }),
      score,
      reasons: [],
    };
  };

  it("filtra items com score ≤ 0 (used_in_session penalty marcou)", () => {
    const pool: ScoredContentItem[] = [
      makeScored("ok1", 8),
      makeScored("penalized", -90),
      makeScored("ok2", 6),
    ];
    const slim = slicePoolForDrota(pool, { excludeUsedInSession: true });
    expect(slim.map((s) => s.item.id)).toEqual(["ok1", "ok2"]);
  });

  it("excludeUsedInSession=false mantém items penalizados", () => {
    const pool: ScoredContentItem[] = [
      makeScored("ok1", 8),
      makeScored("penalized", -90),
    ];
    const slim = slicePoolForDrota(pool, { excludeUsedInSession: false });
    expect(slim.map((s) => s.item.id)).toEqual(["ok1", "penalized"]);
  });

  it("slice top-K (default 7)", () => {
    const pool: ScoredContentItem[] = Array.from({ length: 12 }, (_, i) =>
      makeScored(`item${i}`, 10 - i),
    );
    const slim = slicePoolForDrota(pool);
    expect(slim).toHaveLength(7);
    expect(slim.map((s) => s.item.id)).toEqual([
      "item0",
      "item1",
      "item2",
      "item3",
      "item4",
      "item5",
      "item6",
    ]);
  });

  it("maxItems custom override default", () => {
    const pool: ScoredContentItem[] = Array.from({ length: 8 }, (_, i) =>
      makeScored(`i${i}`, 10 - i),
    );
    const slim = slicePoolForDrota(pool, { maxItems: 3 });
    expect(slim).toHaveLength(3);
  });

  it("maxTotalChars=2000 trunca items longos preservando id/type", () => {
    // 7 items × 700 chars cada ≈ 4900 — excede 2000
    const pool: ScoredContentItem[] = Array.from({ length: 7 }, (_, i) =>
      makeScored(`big${i}`, 10 - i, 700),
    );
    const slim = slicePoolForDrota(pool, { maxTotalChars: 2000 });
    expect(slim).toHaveLength(7); // não corta items, trunca campos
    // ids preservados
    expect(slim.map((s) => s.item.id)).toEqual([
      "big0",
      "big1",
      "big2",
      "big3",
      "big4",
      "big5",
      "big6",
    ]);
    // pelo menos 1 item teve fact truncado (vai ter "..." no fim)
    const trunced = slim.filter((s) => {
      const f = (s.item as { fact?: string }).fact ?? "";
      return f.endsWith("...");
    });
    expect(trunced.length).toBeGreaterThan(0);
  });

  it("maxTotalChars não corta quando pool é pequeno", () => {
    const pool: ScoredContentItem[] = [
      makeScored("small1", 10, 100),
      makeScored("small2", 9, 100),
    ];
    const slim = slicePoolForDrota(pool, { maxTotalChars: 2000 });
    // Itens não truncados — fact original preservado
    expect((slim[0]!.item as { fact?: string }).fact?.endsWith("...")).toBeFalsy();
  });

  it("pool vazio → array vazio", () => {
    expect(slicePoolForDrota([])).toEqual([]);
  });

  it("todos com score ≤ 0 → array vazio (com excludeUsedInSession)", () => {
    const pool: ScoredContentItem[] = [
      makeScored("a", -100),
      makeScored("b", -100),
    ];
    expect(slicePoolForDrota(pool)).toEqual([]);
  });
});
