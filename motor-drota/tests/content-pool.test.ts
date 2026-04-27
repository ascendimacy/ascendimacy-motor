import { describe, it, expect } from "vitest";
import { rankPool } from "../src/evaluate.js";
import { selectFromPool } from "../src/select.js";
import type {
  ScoredContentItem,
  ContentItem,
  SessionState,
} from "@ascendimacy/shared";

const stubState: SessionState = {
  sessionId: "test-session",
  trustLevel: 0.5,
  budgetRemaining: 15,
  eventLog: [],
  turn: 1,
};

const hook = (id: string, score: number, overrides: Partial<ContentItem> = {}): ScoredContentItem => ({
  item: {
    id,
    type: "curiosity_hook",
    domain: "linguistics",
    casel_target: ["SA"],
    age_range: [7, 14],
    surprise: 9,
    verified: true,
    base_score: 7,
    fact: "Os Inuit têm 50+ palavras pra neve.",
    bridge: "Quantas palavras você tem pra RAIVA?",
    quest: "Encontre 5 palavras pro que sente agora.",
    sacrifice_type: "reflect",
    ...overrides,
  } as ContentItem,
  score,
  reasons: ["base_score=7"],
});

describe("rankPool + selectFromPool — v1 hooks-only (plan §4.12)", () => {
  it("selected item always comes from pool (ancoragem)", () => {
    const pool = [hook("h1", 7), hook("h2", 10), hook("h3", 5)];
    const { selected } = selectFromPool(rankPool(pool), stubState);
    // O selecionado DEVE ter id que existe no pool original.
    const originalIds = pool.map((s) => s.item.id);
    expect(originalIds).toContain(selected.item.id);
  });

  it("ScoredContentItem preserves full content item", () => {
    const pool = [hook("h1", 9)];
    const { selected } = selectFromPool(pool, stubState);
    expect(selected.item.id).toBe("h1");
    // Campos obrigatórios do hook preservados.
    expect((selected.item as ContentItem & { fact: string }).fact).toBeTruthy();
  });
});

describe("content-pool — edge cases", () => {
  it("tied scores: first in array wins after stable sort", () => {
    const pool = [hook("a", 7), hook("b", 7)];
    const ranked = rankPool(pool);
    // Stable-sort semantics: desc order preserved order for ties.
    expect(ranked[0]!.item.id).toBe("a");
  });

  it("selectFromPool throws on empty pool (caller must fallback)", () => {
    expect(() => selectFromPool([], stubState)).toThrow(/empty pool/);
  });

  it("group_compatible propagates in serialized item (Bloco 6 prep)", () => {
    const pool = [hook("dyad", 9, { group_compatible: true })];
    const { selected } = selectFromPool(pool, stubState);
    expect(selected.item.group_compatible).toBe(true);
  });
});
